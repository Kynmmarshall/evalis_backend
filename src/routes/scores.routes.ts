import { Router } from 'express';

import { query } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../utils/http-error';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can view score summaries');
  }
  const scores = await query(
    `SELECT id, name, score, sent
     FROM student_scores
     ORDER BY recorded_at DESC`
  );
  res.json({ scores });
});

router.post('/export', requireAuth, async (req, res) => {
  if (req.user!.role !== 'lecturer') {
    throw new HttpError(403, 'Only lecturers can trigger exports');
  }
  await query(`UPDATE student_scores SET sent = TRUE WHERE sent = FALSE`);
  res.json({ message: 'Export queued and marked as sent' });
});

export default router;
