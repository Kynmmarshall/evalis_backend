import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '../config/env';
import { HttpError } from '../utils/http-error';

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing authorization header');
  }
  const token = header.substring(7);
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub: string; role: 'lecturer' | 'student' };
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (error) {
    throw new HttpError(401, 'Invalid or expired token');
  }
}
