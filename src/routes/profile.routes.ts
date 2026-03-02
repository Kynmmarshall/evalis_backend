import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';

import { env } from '../config/env';
import { query } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../utils/http-error';

const router = Router();

router.get('/student', requireAuth, async (req, res) => {
  const profile = await fetchProfile(req.user!.id);
  const enrollments = await query(
    `SELECT ce.id, ce.status, ce.course_code,
            json_build_object('code', c.code, 'title', c.title, 'lecturer', c.lecturer, 'schedule', c.schedule) AS course
     FROM course_enrollments ce
     JOIN courses c ON c.code = ce.course_code
     WHERE ce.user_id = $1
     ORDER BY ce.created_at DESC`,
    [req.user!.id]
  );
  res.json({ profile, enrollments });
});

router.get('/lecturer', requireAuth, async (req, res) => {
  const profile = await fetchProfile(req.user!.id);
  const courses = await query(
    `SELECT c.code, c.title, c.schedule, c.lecturer
     FROM user_courses uc
     JOIN courses c ON c.code = uc.course_code
     WHERE uc.user_id = $1
     ORDER BY c.title ASC`,
    [req.user!.id]
  );
  res.json({ profile: { ...profile, courses }, courses });
});

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${req.user!.id}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage: avatarStorage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads allowed'));
    }
    cb(null, true);
  },
});

router.post('/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  if (!req.file) {
    throw new HttpError(400, 'No avatar uploaded');
  }
  const relativePath = `/avatars/${req.file.filename}`;
  const publicUrl = env.assetBaseUrl
    ? `${env.assetBaseUrl.replace(/\/$/, '')}${relativePath}`
    : `/uploads${relativePath}`;
  await query(`UPDATE app_users SET avatar_url = $1 WHERE id = $2`, [publicUrl, req.user!.id]);
  res.json({ avatarUrl: publicUrl });
});

async function fetchProfile(userId: string) {
  const rows = await query(
    `SELECT id, name, email, role, headline, avatar_url
     FROM app_users WHERE id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) {
    throw new HttpError(404, 'Profile not found');
  }
  return {
    id: row.id,
    full_name: row.name,
    email: row.email,
    role: row.role,
    role_label: row.role,
    headline: row.headline ?? '',
    avatar_url: row.avatar_url,
    courses: [],
  };
}

export default router;
