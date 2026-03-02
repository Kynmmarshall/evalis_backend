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
  examWindow: z.string().min(3),
});

const questionSchema = z.object({
  prompt: z.string().min(8),
  options: z.array(z.string().min(1)).min(2),
  correctIndex: z.number().min(0),
  tip: z.string().optional().default(''),
});

router.get('/', requireAuth, async (_req, res) => {
  const exams = await query(
    `SELECT id, title, course_code AS "courseCode", exam_window AS "examWindow"
     FROM exam_briefs
     ORDER BY created_at DESC`
  );
  res.json({ exams });
});

router.post('/', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can create exams');
  }
  const body = examSchema.parse(req.body);
  const id = `ex-${crypto.randomUUID()}`;
  const rows = await query(
    `INSERT INTO exam_briefs (id, title, course_code, exam_window)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, course_code AS "courseCode", exam_window AS "examWindow"`,
    [id, body.title, body.courseCode, body.examWindow]
  );
  res.status(201).json({ exam: rows[0] });
});

router.get('/:id/questions', requireAuth, async (req, res) => {
  const questions = await query(
    `SELECT q.id, q.prompt, q.correct_index AS "correctIndex", q.tip,
            json_agg(json_build_object('option_index', o.option_index, 'option_text', o.option_text)
              ORDER BY o.option_index) AS options
     FROM mock_questions q
     JOIN mock_question_options o ON o.question_id = q.id
     WHERE q.exam_id = $1
     GROUP BY q.id
     ORDER BY q.created_at ASC`,
    [req.params.id]
  );
  const payload = questions.map((row: any) => ({
    id: row.id,
    prompt: row.prompt,
    correctIndex: row.correctIndex,
    tip: row.tip ?? '',
    options: row.options
      .sort((a: any, b: any) => a.option_index - b.option_index)
      .map((option: any) => option.option_text),
  }));
  res.json({ questions: payload });
});

router.post('/:id/questions', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can add questions');
  }
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

export default router;
