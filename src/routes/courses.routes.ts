import { Router } from 'express';
import { z } from 'zod';

import { query } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../utils/http-error';

const router = Router();

const courseSchema = z.object({
  code: z.string().min(3),
  title: z.string().min(3),
  lecturer: z.string().min(3),
  schedule: z.string().min(3),
});
const courseUpdateSchema = courseSchema.omit({ code: true });

router.get('/', requireAuth, async (_req, res) => {
  const courses = await query(`SELECT code, title, lecturer, schedule FROM courses ORDER BY created_at DESC`);
  res.json({ courses });
});

router.post('/', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can create courses');
  }
  const body = courseSchema.parse(req.body);
  await query(
    `INSERT INTO courses (code, title, lecturer, schedule)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, lecturer = EXCLUDED.lecturer, schedule = EXCLUDED.schedule`,
    [body.code, body.title, body.lecturer, body.schedule]
  );
  res.status(201).json({ message: 'Course saved' });
});

router.put('/:code', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can manage courses');
  }
  const payload = courseUpdateSchema.parse(req.body);
  const { code } = req.params;
  const updated = await query(
    `UPDATE courses SET title = $1, lecturer = $2, schedule = $3 WHERE code = $4 RETURNING code`,
    [payload.title, payload.lecturer, payload.schedule, code]
  );
  if (!updated.length) {
    throw new HttpError(404, 'Course not found');
  }
  res.json({ message: 'Course updated' });
});

router.delete('/:code', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can manage courses');
  }
  const { code } = req.params;
  const removed = await query(`DELETE FROM courses WHERE code = $1 RETURNING code`, [code]);
  if (!removed.length) {
    throw new HttpError(404, 'Course not found');
  }
  res.json({ message: 'Course removed' });
});

export default router;
