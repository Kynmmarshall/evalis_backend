import { Router } from 'express';

import { query } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../utils/http-error';

const router = Router();

type ExamScoreRow = {
  examId: string;
  studentId: string;
  studentName: string;
  answeredQuestions: number;
  correctAnswers: number;
};

router.get('/', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can view score summaries');
  }

  const exams = await query(
    `SELECT e.id,
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

  if (!exams.length) {
    res.json({ exams: [] });
    return;
  }

  const examIds = exams.map((exam) => exam.id);
  let studentRows: ExamScoreRow[] = [];
  if (examIds.length) {
    const placeholders = examIds.map((_, index) => `$${index + 1}`).join(', ');
    studentRows = await query<ExamScoreRow>(
      `SELECT r.exam_id AS "examId",
              r.user_id AS "studentId",
              u.name AS "studentName",
              COUNT(*)::int AS "answeredQuestions",
              SUM(CASE WHEN r.selected_index = q.correct_index THEN 1 ELSE 0)::int AS "correctAnswers"
         FROM exam_responses r
         JOIN mock_questions q ON q.id = r.question_id
         JOIN app_users u ON u.id = r.user_id
        WHERE r.exam_id IN (${placeholders})
        GROUP BY r.exam_id, r.user_id, u.name
        ORDER BY r.exam_id, u.name`,
      examIds
    );
  }

  const grouped = exams.map((exam) => ({
    ...exam,
    students: studentRows
      .filter((row) => row.examId === exam.id)
      .map((row) => ({
        studentId: row.studentId,
        name: row.studentName,
        answeredQuestions: row.answeredQuestions,
        correctAnswers: row.correctAnswers,
      })),
  }));

  res.json({ exams: grouped });
});

router.post('/export', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can trigger exports');
  }
  await query(`UPDATE student_scores SET sent = TRUE WHERE sent = FALSE`);
  res.json({ message: 'Export queued and marked as sent' });
});

export default router;
