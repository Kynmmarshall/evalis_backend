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

export default router;
