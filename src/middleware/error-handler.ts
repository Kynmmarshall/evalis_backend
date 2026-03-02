import { NextFunction, Request, Response } from 'express';

import { HttpError } from '../utils/http-error';

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error(error);
  return res.status(500).json({ message: 'Unexpected server error' });
}
