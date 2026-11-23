export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = 'ERROR',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: unknown): HttpError =>
  new HttpError(400, message, 'BAD_REQUEST', details);
export const forbidden = (message: string): HttpError => new HttpError(403, message, 'FORBIDDEN');
export const notFound = (message: string): HttpError => new HttpError(404, message, 'NOT_FOUND');
