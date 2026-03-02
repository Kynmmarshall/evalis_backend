import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { env } from '../config/env';
import { query } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../utils/http-error';
import { hashPassword, verifyPassword } from '../utils/passwords';

const router = Router();

const userFields = 'id, name, email, role, headline, avatar_url';

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['lecturer', 'student']),
  headline: z.string().optional().default(''),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

router.post('/register', async (req, res) => {
  const body = registerSchema.parse(req.body);
  const existing = await query(`SELECT id FROM app_users WHERE email = $1`, [body.email]);
  if (existing.length) {
    throw new HttpError(409, 'Email already registered');
  }
  const passwordHash = await hashPassword(body.password);
  const rows = await query<{ id: string; name: string; email: string; role: 'lecturer' | 'student'; headline: string; avatar_url: string | null }>(
    `INSERT INTO app_users (name, email, password_hash, role, headline)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${userFields}`,
    [body.name, body.email, passwordHash, body.role, body.headline]
  );
  const user = rows[0];
  const token = signToken(user.id, user.role);
  res.status(201).json({ token, user });
});

router.post('/login', async (req, res) => {
  const body = loginSchema.parse(req.body);
  const rows = await query<{ id: string; name: string; email: string; password_hash: string; role: 'lecturer' | 'student'; headline: string; avatar_url: string | null }>(
    `SELECT id, name, email, password_hash, role, headline, avatar_url FROM app_users WHERE email = $1`,
    [body.email]
  );
  const user = rows[0];
  if (!user) {
    throw new HttpError(401, 'Invalid credentials');
  }
  const ok = await verifyPassword(body.password, user.password_hash);
  if (!ok) {
    throw new HttpError(401, 'Invalid credentials');
  }
  const token = signToken(user.id, user.role);
  const { password_hash, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

router.get('/me', requireAuth, async (req, res) => {
  const rows = await query<{ id: string; name: string; email: string; role: 'lecturer' | 'student'; headline: string; avatar_url: string | null }>(
    `SELECT ${userFields} FROM app_users WHERE id = $1`,
    [req.user!.id]
  );
  const user = rows[0];
  if (!user) {
    throw new HttpError(404, 'User not found');
  }
  res.json({ user });
});

function signToken(id: string, role: 'lecturer' | 'student') {
  return jwt.sign({ role }, env.jwtSecret, { subject: id, expiresIn: '7d' });
}

export default router;
