import 'express-async-errors';
import cors from 'cors';
import express from 'express';
import fs from 'fs';
import morgan from 'morgan';
import path from 'path';

import { errorHandler } from './middleware/error-handler';
import { notFound } from './middleware/not-found';
import authRouter from './routes/auth.routes';
import coursesRouter from './routes/courses.routes';
import enrollmentsRouter from './routes/enrollments.routes';
import examsRouter from './routes/exams.routes';
import profileRouter from './routes/profile.routes';
import scoresRouter from './routes/scores.routes';
import feedbackRouter from './routes/feedback.routes';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

const uploadsDir = path.join(process.cwd(), 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/enrollments', enrollmentsRouter);
app.use('/api/exams', examsRouter);
app.use('/api/scores', scoresRouter);
app.use('/api/feedback', feedbackRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
