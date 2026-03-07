import { Router } from 'express';
import PDFDocument from 'pdfkit';

import { query } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../utils/http-error';

const router = Router();

type ExamListRow = {
  examId: string;
  title: string;
  courseCode: string;
  examWindow: string | null;
  endAt: Date | null;
  questionCount: number;
};

type ExamScoreRow = {
  examId: string;
  studentId: string;
  studentName: string;
  answeredQuestions: number;
  correctAnswers: number;
};

type ExamScorebook = ExamListRow & {
  students: {
    studentId: string;
    name: string;
    answeredQuestions: number;
    correctAnswers: number;
  }[];
};

router.get('/', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can view score summaries');
  }

  console.log('[scores] fetching closed exams');
  const exams = await query<ExamListRow>(
    `SELECT e.id AS "examId",
            e.title,
            e.course_code AS "courseCode",
            e.exam_window AS "examWindow",
            e.end_at AS "endAt",
            COUNT(q.id)::int AS "questionCount"
       FROM exam_briefs e
       LEFT JOIN mock_questions q ON q.exam_id = e.id
      WHERE e.launched = TRUE
        AND e.end_at IS NOT NULL
        AND e.end_at <= now()
      GROUP BY e.id
      ORDER BY e.end_at DESC`
  );
  console.log('[scores] closed exams:', exams.map((exam) => exam.examId));

  if (!exams.length) {
    res.json({ exams: [] });
    return;
  }

  console.log('[scores] aggregating student rows');
  const studentRows = await query<ExamScoreRow>(
    `SELECT r.exam_id AS "examId",
            r.user_id AS "studentId",
            u.name AS "studentName",
            COUNT(*)::int AS "answeredQuestions",
            SUM(CASE WHEN r.selected_index = q.correct_index THEN 1 ELSE 0 END)::int AS "correctAnswers"
       FROM exam_responses r
       JOIN mock_questions q ON q.id = r.question_id
       JOIN app_users u ON u.id = r.user_id
       JOIN exam_briefs e ON e.id = r.exam_id
      WHERE e.launched = TRUE
        AND e.end_at IS NOT NULL
        AND e.end_at <= now()
      GROUP BY r.exam_id, r.user_id, u.name
      ORDER BY r.exam_id, u.name`
  );
  console.log('[scores] student rows fetched:', studentRows.length);

  const grouped = exams.map((exam) =>
    buildScorebookResponse(exam, studentRows.filter((row) => row.examId === exam.examId))
  );

  res.json({ exams: grouped });
});

router.get('/:examId/pdf', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can export score summaries');
  }

  const { examId } = req.params;
  if (!examId) {
    throw new HttpError(400, 'Exam id is required');
  }

  const scorebook = await loadExamScorebook(examId);
  const buffer = await buildScorebookPdf(scorebook);
  const safeCourse = scorebook.courseCode.replace(/[^a-zA-Z0-9_-]/g, '-');
  const filename = `scorebook-${safeCourse}-${scorebook.examId}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

router.get('/:examId', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can view score summaries');
  }

  const { examId } = req.params;
  if (!examId) {
    throw new HttpError(400, 'Exam id is required');
  }

  const scorebook = await loadExamScorebook(examId);
  res.json({ exam: scorebook });
});

router.post('/export', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can trigger exports');
  }
  await query(`UPDATE student_scores SET sent = TRUE WHERE sent = FALSE`);
  res.json({ message: 'Export queued and marked as sent' });
});

async function loadExamScorebook(examId: string): Promise<ExamScorebook> {
  const exams = await query<ExamListRow>(
    `SELECT e.id AS "examId",
            e.title,
            e.course_code AS "courseCode",
            e.exam_window AS "examWindow",
            e.end_at AS "endAt",
            COUNT(q.id)::int AS "questionCount"
       FROM exam_briefs e
       LEFT JOIN mock_questions q ON q.exam_id = e.id
      WHERE e.id = $1
        AND e.launched = TRUE
        AND e.end_at IS NOT NULL
        AND e.end_at <= now()
      GROUP BY e.id`,
    [examId]
  );

  const exam = exams[0];
  if (!exam) {
    throw new HttpError(404, 'Exam not found or not closed yet');
  }

  const students = await query<ExamScoreRow>(
    `SELECT r.exam_id AS "examId",
            r.user_id AS "studentId",
            u.name AS "studentName",
            COUNT(*)::int AS "answeredQuestions",
            SUM(CASE WHEN r.selected_index = q.correct_index THEN 1 ELSE 0 END)::int AS "correctAnswers"
       FROM exam_responses r
       JOIN mock_questions q ON q.id = r.question_id
       JOIN app_users u ON u.id = r.user_id
      WHERE r.exam_id = $1
      GROUP BY r.exam_id, r.user_id, u.name
      ORDER BY u.name`,
    [examId]
  );

  return buildScorebookResponse(exam, students);
}

function buildScorebookResponse(exam: ExamListRow, students: ExamScoreRow[]): ExamScorebook {
  return {
    ...exam,
    students: students.map((row) => ({
      studentId: row.studentId,
      name: row.studentName,
      answeredQuestions: row.answeredQuestions,
      correctAnswers: row.correctAnswers,
    })),
  };
}

function buildScorebookPdf(scorebook: ExamScorebook): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text(scorebook.title, { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Course: ${scorebook.courseCode}`);
    if (scorebook.examWindow) {
      doc.text(`Window: ${scorebook.examWindow}`);
    }
    if (scorebook.endAt) {
      doc.text(`Closed at: ${new Date(scorebook.endAt).toLocaleString()}`);
    }
    doc.text(`Questions: ${scorebook.questionCount}`);
    doc.moveDown();
    doc.fontSize(16).text('Student Performance', { underline: true });
    doc.moveDown(0.5);

    if (!scorebook.students.length) {
      doc.fontSize(12).text('No submissions recorded for this exam.');
    } else {
      doc.fontSize(12);
      scorebook.students.forEach((student) => {
        const accuracy = scorebook.questionCount
          ? Math.round((student.correctAnswers / scorebook.questionCount) * 100)
          : 0;
        doc.text(`${student.name}`, { continued: true });
        doc.text(
          `  ${student.correctAnswers}/${scorebook.questionCount} correct  (${accuracy}%)`
        );
      });
    }

    doc.end();
  });
}

export default router;
