import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Permission, Role } from '@bookstall/shared';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
}

export const IS_PUBLIC = 'isPublic';
export const PERMISSIONS_KEY = 'permissions';
export const ALLOW_PASSWORD_CHANGE = 'allowPasswordChange';

/** Skips authentication entirely. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** The caller needs at least one of the listed permissions. */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);
/** Endpoint is reachable while `must_change_password` is set. */
export const AllowPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  return ctx.switchToHttp().getRequest().ip;
});
