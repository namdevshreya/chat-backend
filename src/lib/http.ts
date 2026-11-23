import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { HttpError } from './errors';

/** Wraps an async handler so rejected promises reach the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Validates data against a zod schema and returns the typed result, or throws a 400. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(
      400,
      'Validation failed',
      'VALIDATION_ERROR',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export const idSchema = z.coerce.number().int().positive();
export const textSchema = z.string().trim().min(1, 'text must not be empty').max(4000);
export const messageIdSchema = z.string().trim().min(1).max(128);
