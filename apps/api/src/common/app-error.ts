import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@bookstall/shared';

const STATUS: Record<string, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  COPY_NOT_AVAILABLE: 409,
  COPY_NOT_AT_YOUR_STALL: 409,
  STALL_NOT_ACTIVE: 409,
  STALL_HAS_OPEN_CHECKOUTS: 409,
  NO_SHELF_SPACE: 409,
  ROW_NOT_EMPTY: 409,
  DISCOUNT_NOT_ALLOWED: 403,
  IMPORT_NOT_READY: 409,
  EXTERNAL_LOOKUP_FAILED: 502,
  RATE_LIMITED: 429,
};

/** Business error carried to the client in the uniform `{ error: { code, message, details } }` envelope. */
export class AppError extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    details?: unknown,
    status?: number,
  ) {
    super({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status ?? STATUS[code] ?? 400);
  }
}
