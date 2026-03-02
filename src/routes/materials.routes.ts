import { Router } from 'express';
import { z } from 'zod';

import { query } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../utils/http-error';

const router = Router();

const materialSchema = z.object({
  title: z.string().min(3),
  topic: z.string().min(3),
  duration: z.string().min(2),
  difficulty: z.string().min(2),
});

router.get('/', requireAuth, async (_req, res) => {
  const materials = await query(`SELECT id, title, topic, duration, difficulty FROM past_materials ORDER BY title ASC`);
  res.json({ materials });
});

router.post('/', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can upload past materials');
  }
  const body = materialSchema.parse(req.body);
  const rows = await query(
    `INSERT INTO past_materials (title, topic, duration, difficulty)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, topic, duration, difficulty`,
    [body.title, body.topic, body.duration, body.difficulty]
  );
  res.status(201).json({ material: rows[0] });
});

export default router;
