import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from './app-error.js';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
        result.error.issues.map((i) => ({ path: i.path, message: i.message })),
      );
    }
    return result.data;
  }
}

export const zod = <T>(schema: ZodType<T>) => new ZodValidationPipe(schema);
