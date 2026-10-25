import { Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getOptionsToken, getStorageToken, ThrottlerGuard, type ThrottlerModuleOptions, type ThrottlerStorage } from '@nestjs/throttler';

/** Tracks per user once authenticated, per IP otherwise; login is tracked per IP + username. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  // Explicit @Inject tokens: dev servers (tsx/esbuild) do not emit the decorator metadata the base class relies on.
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storage: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super(options, storage, reflector);
  }

  override canActivate(ctx: ExecutionContext): Promise<boolean> {
    return ctx.getType() === 'http' ? super.canActivate(ctx) : Promise.resolve(true);
  }

  protected override async getTracker(req: Record<string, any>): Promise<string> {
    if (req.user?.id) return `user:${req.user.id}`;
    const username = req.path?.endsWith('/auth/login') ? String(req.body?.username ?? '').toLowerCase() : '';
    return username ? `${req.ip}|${username}` : String(req.ip);
  }
}
