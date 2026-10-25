import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../app-error.js';
import { ALLOW_PASSWORD_CHANGE, IS_PUBLIC, type AuthUser } from '../decorators/index.js';
import { SessionCache } from '../../modules/auth/session-cache.service.js';
import { TokenService } from '../../modules/auth/token.service.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(SessionCache) private readonly sessions: SessionCache,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // WebSockets authenticate once, in the Socket.IO handshake (see RealtimeGateway).
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const claims = token ? await this.tokens.verifyAccess(token) : null;
    if (!claims) throw new AppError('UNAUTHENTICATED', 'Authentication required');

    const user = await this.sessions.get(claims.sub);
    if (!user || !user.isActive || user.tokenVersion !== claims.tv) {
      throw new AppError('UNAUTHENTICATED', 'Session is no longer valid');
    }
    const authUser: AuthUser = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };
    req.user = authUser;

    if (user.mustChangePassword) {
      const allowed =
        this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE, targets) ||
        req.path.endsWith('/auth/logout');
      if (!allowed) throw new AppError('PASSWORD_CHANGE_REQUIRED', 'You must change your password first');
    }
    return true;
  }
}
