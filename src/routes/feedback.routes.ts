import { Router } from 'express';

import { query } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  const entries = await query(
    `SELECT id, title, status, detail, is_correct AS "isCorrect", created_at AS "createdAt"
     FROM feedback_entries
     ORDER BY created_at DESC`
  );
  res.json({ entries });
});

export default router;
