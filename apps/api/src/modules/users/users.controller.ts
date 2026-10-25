import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, StreamableFile } from '@nestjs/common';
import type { Request } from 'express';
import {
  createUserBodySchema, credentialSlipQuerySchema, listUsersQuerySchema, updateUserBodySchema, uuidSchema,
  type CreateUserBody, type ListUsersQuery, type UpdateUserBody,
} from '@bookstall/shared';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators/index.js';
import { zod } from '../../common/zod-validation.pipe.js';
import { CredentialSlipService } from './credential-slip.service.js';
import { UsersService } from './users.service.js';

@Controller('users')
@RequirePermission('user.manage')
export class UsersController {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(CredentialSlipService) private readonly slips: CredentialSlipService,
  ) {}

  @Get()
  list(@Query(zod(listUsersQuerySchema)) q: ListUsersQuery) {
    return this.users.list(q);
  }

  @Get(':id')
  get(@Param('id', zod(uuidSchema)) id: string) {
    return this.users.get(id);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Body(zod(createUserBodySchema)) body: CreateUserBody, @Req() req: Request) {
    return this.users.create(me.id, body, req.ip);
  }

  @Patch(':id')
  update(
    @CurrentUser() me: AuthUser,
    @Param('id', zod(uuidSchema)) id: string,
    @Body(zod(updateUserBodySchema)) body: UpdateUserBody,
    @Req() req: Request,
  ) {
    return this.users.update(me.id, id, body, req.ip);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Req() req: Request) {
    return this.users.resetPassword(me.id, id, req.ip);
  }

  /** Printable slip; the token comes from the create/reset response and works once. */
  @Get(':id/credential-slip.pdf')
  async slip(@Param('id', zod(uuidSchema)) id: string, @Query(zod(credentialSlipQuerySchema)) q: { token: string }) {
    return new StreamableFile(await this.slips.render(id, q.token), {
      type: 'application/pdf',
      disposition: 'inline; filename="login-slip.pdf"',
    });
  }
}
