import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import { query } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../utils/http-error';

const router = Router();

const courseSchema = z.object({
  code: z.string().min(3).optional(),
  title: z.string().min(3),
  lecturer: z.string().optional(),
  schedule: z.string().min(3).optional(),
});
const courseUpdateSchema = z.object({
  title: z.string().min(3),
  lecturer: z.string().optional(),
  schedule: z.string().min(3).optional(),
});

function generateCourseCode(title: string): string {
  const normalized = title.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const suffix = randomUUID().slice(0, 4).toUpperCase();
  return `${normalized || 'COURSE'}-${suffix}`;
}

function normalizeSchedule(schedule?: string): string {
  const trimmed = schedule?.trim();
  return trimmed && trimmed.length >= 3 ? trimmed : 'To be announced';
}

async function resolveLecturerName(candidate: string | undefined, userId: string): Promise<string> {
  const trimmed = candidate?.trim();
  if (trimmed && trimmed.length >= 3) {
    return trimmed;
  }
  const [user] = await query(`SELECT name FROM app_users WHERE id = $1`, [userId]);
  const fallback = typeof user?.name === 'string' ? user.name.trim() : '';
  if (fallback.length >= 3) {
    return fallback;
  }
  throw new HttpError(400, 'Lecturer profile is missing a display name. Update your profile and try again.');
}

router.get('/', requireAuth, async (_req, res) => {
  const courses = await query(`SELECT code, title, lecturer, schedule FROM courses ORDER BY created_at DESC`);
  res.json({ courses });
});

router.post('/', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can create courses');
  }
  const body = courseSchema.parse(req.body);
  const code = body.code ?? generateCourseCode(body.title);
  const schedule = normalizeSchedule(body.schedule);
  const lecturerName = await resolveLecturerName(body.lecturer, req.user!.id);
  await query(
    `INSERT INTO courses (code, title, lecturer, schedule)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, lecturer = EXCLUDED.lecturer, schedule = EXCLUDED.schedule`,
    [code, body.title, lecturerName, schedule]
  );
  await query(
    `INSERT INTO user_courses (user_id, course_code)
     VALUES ($1, $2)
     ON CONFLICT (user_id, course_code) DO NOTHING`,
    [req.user!.id, code]
  );
  res.status(201).json({ message: 'Course saved', code });
});

router.put('/:code', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can manage courses');
  }
  const payload = courseUpdateSchema.parse(req.body);
  const lecturerName = await resolveLecturerName(payload.lecturer, req.user!.id);
  const { code } = req.params;
  const updated = await query(
    `UPDATE courses SET title = $1, lecturer = $2, schedule = COALESCE($3, schedule) WHERE code = $4 RETURNING code`,
    [payload.title, lecturerName, payload.schedule ? normalizeSchedule(payload.schedule) : null, code]
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
