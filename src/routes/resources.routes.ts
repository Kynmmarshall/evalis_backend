import { Router } from 'express';
import { z } from 'zod';

import { query } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../utils/http-error';

const router = Router();

const resourceSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(5),
  format: z.string().min(2),
  eta: z.string().min(2),
});

router.get('/', requireAuth, async (_req, res) => {
  const resources = await query(
    `SELECT id, title, description, format, eta
     FROM learning_resources
     ORDER BY created_at DESC`
  );
  res.json({ resources });
});

router.post('/', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can add resources');
  }
  const body = resourceSchema.parse(req.body);
  const rows = await query(
    `INSERT INTO learning_resources (title, description, format, eta)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, description, format, eta`,
    [body.title, body.description, body.format, body.eta]
  );
  res.status(201).json({ resource: rows[0] });
});

export default router;
