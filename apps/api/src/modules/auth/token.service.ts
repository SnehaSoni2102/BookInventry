import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import type { Role } from '@bookstall/shared';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

export interface AccessClaims {
  sub: string;
  role: Role;
  tv: number;
}

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
export function parseDurationSeconds(v: string): number {
  const m = /^(\d+)([smhd])$/.exec(v);
  if (!m) throw new Error(`Invalid duration: ${v}`);
  return Number(m[1]) * UNITS[m[2]!]!;
}

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;
  readonly accessTtlSeconds: number;

  constructor(@Inject(ENV) env: Env) {
    // Dev/test fallback only; production boot is refused without a secret (see env.ts).
    this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET ?? 'dev-only-insecure-secret-do-not-use-in-prod!!');
    this.accessTtlSeconds = parseDurationSeconds(env.JWT_ACCESS_TTL);
  }

  signAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({ role: claims.role, tv: claims.tv })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtlSeconds}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      if (!payload.sub || typeof payload.tv !== 'number' || typeof payload.role !== 'string') return null;
      return { sub: payload.sub, role: payload.role as Role, tv: payload.tv };
    } catch {
      return null;
    }
  }

  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: TokenService.hashRefresh(token) };
  }

  static hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
