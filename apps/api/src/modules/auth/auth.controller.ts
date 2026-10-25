import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  changePasswordBodySchema, loginBodySchema, refreshBodySchema,
  type ChangePasswordBody, type LoginBody, type LoginResponse,
} from '@bookstall/shared';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AppError } from '../../common/app-error.js';
import { AllowPasswordChange, CurrentUser, Public, type AuthUser } from '../../common/decorators/index.js';
import { zod } from '../../common/zod-validation.pipe.js';
import { AuthService, type IssuedSession } from './auth.service.js';

export const REFRESH_COOKIE = 'refresh_token';
const COOKIE_PATH = '/api/v1/auth';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private setCookie(res: Response, s: IssuedSession) {
    res.cookie(REFRESH_COOKIE, s.refreshToken, {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: COOKIE_PATH,
      expires: s.refreshExpiresAt,
    });
  }

  private respond(res: Response, s: IssuedSession, client: 'web' | 'mobile'): LoginResponse {
    if (client === 'web') this.setCookie(res, s);
    return {
      accessToken: s.accessToken,
      ...(client === 'mobile' ? { refreshToken: s.refreshToken } : {}),
      user: s.user,
      mustChangePassword: s.user.mustChangePassword,
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body(zod(loginBodySchema)) body: LoginBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.login(body, { ip: req.ip, userAgent: req.get('user-agent') });
    return this.respond(res, s, body.client);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body(zod(refreshBodySchema)) body: { refreshToken?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    const token = cookieToken ?? body.refreshToken;
    if (!token) throw new AppError('UNAUTHENTICATED', 'No refresh token');
    const s = await this.auth.refresh(token, { userAgent: req.get('user-agent') });
    return this.respond(res, s, cookieToken ? 'web' : 'mobile');
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body(zod(refreshBodySchema)) body: { refreshToken?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout((req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? body.refreshToken);
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  @Get('me')
  @AllowPasswordChange()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Post('change-password')
  @HttpCode(200)
  @AllowPasswordChange()
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(zod(changePasswordBodySchema)) body: ChangePasswordBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.auth.changePassword(user.id, body, req.ip);
    // Web sessions stay on the cookie; mobile sends its refresh token in the body, so return it when no cookie was used.
    const isWeb = Boolean(req.cookies?.[REFRESH_COOKIE]);
    return this.respond(res, s, isWeb ? 'web' : 'mobile');
  }
}
