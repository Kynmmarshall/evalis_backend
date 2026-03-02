import { Router } from 'express';
import { z } from 'zod';

import { query } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../utils/http-error';

const router = Router();

const requestSchema = z.object({
  courseCode: z.string().min(2),
});

const statusSchema = z.object({
  status: z.enum(['pending', 'approved']),
});

router.get('/me', requireAuth, async (req, res) => {
  const rows = await query(
    `SELECT ce.id, ce.status,
            json_build_object('code', c.code, 'title', c.title, 'lecturer', c.lecturer, 'schedule', c.schedule) AS course
     FROM course_enrollments ce
     JOIN courses c ON c.code = ce.course_code
     WHERE ce.user_id = $1
     ORDER BY ce.created_at DESC`,
    [req.user!.id]
  );
  res.json({ enrollments: rows });
});

router.post('/requests', requireAuth, async (req, res) => {
  if (req.user!.role !== 'student') {
    throw new HttpError(403, 'Only students can request enrollments');
  }
  const body = requestSchema.parse(req.body);
  const existing = await query(`SELECT id FROM course_enrollments WHERE user_id = $1 AND course_code = $2`, [
    req.user!.id,
    body.courseCode,
  ]);
  if (existing.length) {
    throw new HttpError(409, 'You already requested this course');
  }
  await query(
    `INSERT INTO course_enrollments (user_id, course_code)
     VALUES ($1, $2)`,
    [req.user!.id, body.courseCode]
  );
  res.status(201).json({ message: 'Enrollment request submitted' });
});

router.get('/pending', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can view pending requests');
  }
  const rows = await query(
    `SELECT ce.id, ce.status, ce.course_code, c.title, c.schedule,
            au.name AS student_name, au.email AS student_email,
            to_char(ce.created_at, 'Mon DD, YYYY') AS submitted_on
     FROM course_enrollments ce
     JOIN courses c ON c.code = ce.course_code
     JOIN app_users au ON au.id = ce.user_id
     WHERE ce.status = 'pending'
       AND EXISTS (
         SELECT 1 FROM user_courses uc
         WHERE uc.user_id = $1 AND uc.course_code = ce.course_code
       )
     ORDER BY ce.created_at ASC`,
    [req.user!.id]
  );
  res.json({ requests: rows });
});

router.patch('/:id', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can update enrollments');
  }
  const body = statusSchema.parse(req.body);
  const enrollment = await query<{ course_code: string }>(
    `SELECT course_code FROM course_enrollments WHERE id = $1`,
    [req.params.id]
  );
  const row = enrollment[0];
  if (!row) {
    throw new HttpError(404, 'Enrollment not found');
  }
  const ownership = await query(
    `SELECT 1 FROM user_courses WHERE user_id = $1 AND course_code = $2`,
    [req.user!.id, row.course_code]
  );
  if (!ownership.length) {
    throw new HttpError(403, 'You cannot modify this course');
  }
  await query(`UPDATE course_enrollments SET status = $1 WHERE id = $2`, [body.status, req.params.id]);
  res.json({ message: 'Enrollment updated' });
});

export default router;
