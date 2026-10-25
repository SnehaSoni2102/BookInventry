import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, type Permission } from '@bookstall/shared';
import { AppError } from '../app-error.js';
import { IS_PUBLIC, PERMISSIONS_KEY } from '../decorators/index.js';

/** Guards check permissions, never role names. Endpoints with no @RequirePermission need only a valid login. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, targets);
    if (!required?.length) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user || !required.some((p) => can(user, p))) {
      throw new AppError('FORBIDDEN', 'You do not have permission to do this');
    }
    return true;
  }
}
