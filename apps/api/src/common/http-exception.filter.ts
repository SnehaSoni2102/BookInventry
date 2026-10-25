import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';

const BY_STATUS: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    if (exception instanceof ThrottlerException) {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as any;
      if (body && typeof body === 'object' && body.error?.code) {
        res.status(status).json(body);
        return;
      }
      const message = typeof body === 'string' ? body : (body?.message ?? exception.message);
      res.status(status).json({
        error: {
          code: BY_STATUS[status] ?? 'CONFLICT',
          message: Array.isArray(message) ? message.join('; ') : message,
        },
      });
      return;
    }
    // body-parser errors (too large, malformed JSON)
    const e = exception as { status?: number; type?: string };
    if (e?.status && e.status >= 400 && e.status < 500) {
      res.status(e.status).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid request body' } });
      return;
    }
    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  }
}
