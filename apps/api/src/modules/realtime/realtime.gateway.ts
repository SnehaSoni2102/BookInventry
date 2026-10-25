import { Inject, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { can } from '@bookstall/shared';
import { EventBus } from '../../common/events/event-bus.js';
import { ScopeService } from '../../common/scope.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { SessionCache } from '../auth/session-cache.service.js';
import { TokenService } from '../auth/token.service.js';

/**
 * Pushes small "something changed" events; clients invalidate their TanStack Query caches and refetch.
 * The Socket.IO path is /rt/socket.io so Caddy's `/rt/*` proxy rule covers it. Events are routed by room:
 * user:{id}, role:admin, stall:{id}; an event with no rooms goes to every connected user.
 */
@WebSocketGateway({ path: '/rt/socket.io', transports: ['websocket', 'polling'], cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() private server!: Server;
  private unsubscribe: (() => void) | undefined;

  constructor(
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(SessionCache) private readonly sessions: SessionCache,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    this.unsubscribe = this.bus.subscribe((e) => {
      if (!this.server) return;
      if (e.name === 'session.revoked') {
        for (const room of e.rooms ?? []) {
          this.server.to(room).emit(e.name, e.payload);
          this.server.in(room).disconnectSockets(true);
        }
        return;
      }
      if (e.rooms?.length) this.server.to(e.rooms).emit(e.name, e.payload);
      else this.server.emit(e.name, e.payload);
    });
  }

  onModuleDestroy() {
    this.unsubscribe?.();
  }

  afterInit(server: Server) {
    // Authenticate during the handshake so unauthenticated sockets never connect.
    server.use(async (socket, next) => {
      try {
        const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
        const claims = token ? await this.tokens.verifyAccess(token) : null;
        if (!claims) return next(new Error('UNAUTHENTICATED'));
        const user = await this.sessions.get(claims.sub);
        if (!user || !user.isActive || user.tokenVersion !== claims.tv) return next(new Error('UNAUTHENTICATED'));
        if (user.mustChangePassword) return next(new Error('PASSWORD_CHANGE_REQUIRED'));
        socket.data.user = { id: user.id, role: user.role };
        next();
      } catch (e) {
        this.logger.warn(`handshake failed: ${e instanceof Error ? e.message : e}`);
        next(new Error('UNAUTHENTICATED'));
      }
    });
  }

  async handleConnection(socket: Socket) {
    const user = socket.data.user as { id: string; role: 'ADMIN' | 'INVENTORY_STAFF' | 'STALL_MANAGER' } | undefined;
    if (!user) return;
    await socket.join(`user:${user.id}`);
    if (can(user, 'sale.read.all')) await socket.join('role:admin');
    if (!can(user, 'inventory.read')) {
      const stallId = await this.scope.activeStallId(user.id);
      if (stallId) await socket.join(`stall:${stallId}`);
    }
  }

  /** Admins can watch any stall's room. */
  @SubscribeMessage('subscribe:stall')
  async subscribeStall(@ConnectedSocket() socket: Socket, @MessageBody() body: { stallId?: string }) {
    const user = socket.data.user as { id: string; role: 'ADMIN' | 'INVENTORY_STAFF' | 'STALL_MANAGER' };
    if (!can(user, 'sale.read.all') || typeof body?.stallId !== 'string' || !/^[0-9a-f-]{36}$/.test(body.stallId)) return { ok: false };
    await socket.join(`stall:${body.stallId}`);
    return { ok: true };
  }
}
