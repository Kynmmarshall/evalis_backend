import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';

import { query } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../utils/http-error';

const router = Router();

const examSchema = z.object({
  title: z.string().min(3),
  courseCode: z.string().min(2),
  examWindow: z.string().min(3).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  launched: z.boolean().optional(),
});

const scheduleSchema = z.object({
  examWindow: z.string().min(3),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  launched: z.boolean(),
});

const questionSchema = z.object({
  prompt: z.string().min(8),
  options: z.array(z.string().min(1)).min(2),
  correctIndex: z.number().min(0),
  tip: z.string().optional().default(''),
});

const responseSchema = z.object({
  optionIndex: z.number().int().min(0),
});

type ExamGuardRow = {
  courseCode: string;
  startAt: Date | null;
  endAt: Date | null;
  launched: boolean;
};

type QuestionGuardRow = {
  examId: string;
  optionCount: number;
};

router.get('/', requireAuth, async (req, res) => {
  const baseSelect =
    `SELECT id, title, course_code AS "courseCode", exam_window AS "examWindow",
            start_at AS "startAt", end_at AS "endAt", launched
       FROM exam_briefs`;
  if (req.user!.role === 'lecturer') {
    const exams = await query(`${baseSelect} ORDER BY created_at DESC`);
    res.json({ exams });
    return;
  }

  const state = typeof req.query.state === 'string' ? req.query.state : 'live';
  let sql: string;
  switch (state) {
    case 'closed':
      sql = `${baseSelect}
               WHERE launched = TRUE
                 AND end_at IS NOT NULL
                 AND end_at <= now()
               ORDER BY end_at DESC`;
      break;
    case 'live':
    default:
      sql = `${baseSelect}
               WHERE launched = TRUE
                 AND start_at IS NOT NULL
                 AND end_at IS NOT NULL
                 AND now() >= start_at
                 AND now() < end_at
               ORDER BY start_at ASC`;
      break;
  }
  const exams = await query(sql);
  res.json({ exams });
});

router.post('/', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can create exams');
  }
  const body = examSchema.parse(req.body);
  await assertCourseOwnership(req.user!.id, body.courseCode);
  const id = `ex-${crypto.randomUUID()}`;
  const { startAt, endAt } = parseSchedule(body.startAt, body.endAt);
  const launched = body.launched ?? false;
  if (launched && (!startAt || !endAt)) {
    throw new HttpError(400, 'Define a time window before launching an exam');
  }
  const examWindow = (body.examWindow ?? 'Unscheduled window').trim();
  const rows = await query(
    `INSERT INTO exam_briefs (id, title, course_code, exam_window, start_at, end_at, launched)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, title, course_code AS "courseCode", exam_window AS "examWindow",
               start_at AS "startAt", end_at AS "endAt", launched`,
    [id, body.title, body.courseCode, examWindow, startAt, endAt, launched]
  );
  res.status(201).json({ exam: rows[0] });
});

router.patch('/:id/schedule', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can schedule exams');
  }
  const body = scheduleSchema.parse(req.body);
  const exam = await ensureExamOwnership(req.user!.id, req.params.id);
  const startAt = parseDate(body.startAt);
  const endAt = parseDate(body.endAt);
  validateWindow(startAt, endAt);
  const examWindow = body.examWindow.trim();
  const rows = await query(
    `UPDATE exam_briefs
        SET exam_window = $1,
            start_at = $2,
            end_at = $3,
            launched = $4
      WHERE id = $5
      RETURNING id, title, course_code AS "courseCode", exam_window AS "examWindow",
                start_at AS "startAt", end_at AS "endAt", launched`,
    [examWindow, startAt, endAt, body.launched, exam.id]
  );
  res.json({ exam: rows[0] });
});

router.get('/:id/questions', requireAuth, async (req, res) => {
  const exam = await loadExamGuardRow(req.params.id);
  if (!exam) {
    throw new HttpError(404, 'Exam not found');
  }
  if (req.user!.role === 'student' && !isExamLive(exam) && !isExamClosed(exam)) {
    throw new HttpError(403, 'Exam is not available right now');
  }
  const questions = await query(
    `SELECT q.id, q.prompt, q.correct_index AS "correctIndex", q.tip,
            json_agg(json_build_object('option_index', o.option_index, 'option_text', o.option_text)
              ORDER BY o.option_index) AS options
     FROM mock_questions q
     JOIN mock_question_options o ON o.question_id = q.id
     WHERE q.exam_id = $1
     GROUP BY q.id
     ORDER BY q.id ASC`,
    [req.params.id]
  );
  let responseMap: Record<string, number> = {};
  if (req.user!.role === 'student') {
    const responses = await query<{ questionId: string; selectedIndex: number }>(
      `SELECT question_id AS "questionId", selected_index AS "selectedIndex"
         FROM exam_responses
        WHERE exam_id = $1 AND user_id = $2`,
      [req.params.id, req.user!.id]
    );
    responseMap = responses.reduce<Record<string, number>>((acc, row) => {
      acc[row.questionId] = row.selectedIndex;
      return acc;
    }, {});
  }
  const payload = questions.map((row: any) => ({
    id: row.id,
    prompt: row.prompt,
    correctIndex: row.correctIndex,
    tip: row.tip ?? '',
    options: row.options
      .sort((a: any, b: any) => a.option_index - b.option_index)
      .map((option: any) => option.option_text),
    selectedIndex: responseMap[row.id] ?? null,
  }));
  res.json({ questions: payload });
});

router.post('/:id/questions', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can add questions');
  }
  await ensureExamOwnership(req.user!.id, req.params.id);
  const body = questionSchema.parse(req.body);
  if (body.correctIndex >= body.options.length) {
    throw new HttpError(400, 'correctIndex out of range');
  }
  const questionId = crypto.randomUUID();
  await query(
    `INSERT INTO mock_questions (id, exam_id, prompt, correct_index, tip)
     VALUES ($1, $2, $3, $4, $5)`,
    [questionId, req.params.id, body.prompt, body.correctIndex, body.tip]
  );
  for (let i = 0; i < body.options.length; i += 1) {
    await query(
      `INSERT INTO mock_question_options (question_id, option_index, option_text)
       VALUES ($1, $2, $3)`,
      [questionId, i, body.options[i]]
    );
  }
  res.status(201).json({ message: 'Question saved', id: questionId });
});

router.post('/:id/questions/:questionId/response', requireAuth, async (req, res) => {
  if (req.user!.role !== 'student') {
    throw new HttpError(403, 'Only students can record responses');
  }
  const body = responseSchema.parse(req.body);
  const exam = await loadExamGuardRow(req.params.id);
  if (!exam) {
    throw new HttpError(404, 'Exam not found');
  }
  if (!isExamLive(exam)) {
    throw new HttpError(403, 'Exam is not live');
  }
  const question = await loadQuestionGuardRow(req.params.questionId);
  if (!question) {
    throw new HttpError(404, 'Question not found');
  }
  if (question.examId !== req.params.id) {
    throw new HttpError(400, 'Question does not belong to this exam');
  }
  if (body.optionIndex >= question.optionCount) {
    throw new HttpError(400, 'optionIndex out of range');
  }
  const inserted = await query<{ selectedIndex: number }>(
    `INSERT INTO exam_responses (exam_id, question_id, user_id, selected_index)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (question_id, user_id) DO NOTHING
     RETURNING selected_index AS "selectedIndex"`,
    [req.params.id, req.params.questionId, req.user!.id, body.optionIndex]
  );
  let selectedIndex = body.optionIndex;
  if (!inserted.length) {
    const existing = await query<{ selectedIndex: number }>(
      `SELECT selected_index AS "selectedIndex"
         FROM exam_responses
        WHERE question_id = $1 AND user_id = $2`,
      [req.params.questionId, req.user!.id]
    );
    if (!existing.length) {
      throw new HttpError(500, 'Unable to save response');
    }
    selectedIndex = existing[0].selectedIndex;
  }
  res.status(inserted.length ? 201 : 200).json({ selectedIndex });
});

router.post('/:id/delete', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can delete exams');
  }
  await ensureExamOwnership(req.user!.id, req.params.id);
  await query('DELETE FROM exam_briefs WHERE id = $1', [req.params.id]);
  res.json({ message: 'Exam deleted' });
});

function parseSchedule(startAt?: string, endAt?: string) {
  const start = startAt ? parseDate(startAt) : null;
  const end = endAt ? parseDate(endAt) : null;
  validateWindow(start, end);
  return { startAt: start, endAt: end };
}

function parseDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'Invalid date value');
  }
  return parsed;
}

function validateWindow(startAt?: Date | null, endAt?: Date | null) {
  if ((startAt && !endAt) || (!startAt && endAt)) {
    throw new HttpError(400, 'Provide both start and end times');
  }
  if (startAt && endAt && endAt <= startAt) {
    throw new HttpError(400, 'End time must be after start time');
  }
}

async function assertCourseOwnership(userId: string, courseCode: string) {
  const ownership = await query(
    `SELECT 1 FROM user_courses WHERE user_id = $1 AND course_code = $2`,
    [userId, courseCode]
  );
  if (!ownership.length) {
    throw new HttpError(403, 'You cannot manage this course');
  }
}

async function ensureExamOwnership(userId: string, examId: string) {
  const exam = await loadExamGuardRow(examId);
  if (!exam) {
    throw new HttpError(404, 'Exam not found');
  }
  await assertCourseOwnership(userId, exam.courseCode);
  return { ...exam, id: examId };
}

async function loadExamGuardRow(examId: string) {
  const rows = await query<ExamGuardRow & { id?: string }>(
    `SELECT course_code AS "courseCode", start_at AS "startAt", end_at AS "endAt", launched
       FROM exam_briefs
      WHERE id = $1`,
    [examId]
  );
  return rows[0];
}

async function loadQuestionGuardRow(questionId: string) {
  const rows = await query<QuestionGuardRow>(
    `SELECT q.exam_id AS "examId",
            COUNT(o.option_index)::int AS "optionCount"
       FROM mock_questions q
       JOIN mock_question_options o ON o.question_id = q.id
      WHERE q.id = $1
      GROUP BY q.exam_id`,
    [questionId]
  );
  return rows[0];
}

function isExamLive(exam: ExamGuardRow): boolean {
  if (!exam.launched || !exam.startAt || !exam.endAt) {
    return false;
  }
  const now = new Date();
  return now >= exam.startAt && now < exam.endAt;
}

function isExamClosed(exam: ExamGuardRow): boolean {
  if (!exam.launched || !exam.endAt) {
    return false;
  }
  const now = new Date();
  return now >= exam.endAt;
}

export default router;
