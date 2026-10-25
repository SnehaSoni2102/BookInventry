import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createCopiesBodySchema, moveCopyBodySchema, updateCopyBodySchema, uuidSchema, writeOffBodySchema,
  type CreateCopiesBody, type MoveCopyBody, type UpdateCopyBody, type WriteOffBody,
} from '@bookstall/shared';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators/index.js';
import { ScopeService } from '../../common/scope.js';
import { zod } from '../../common/zod-validation.pipe.js';
import { CopiesService } from './copies.service.js';

@Controller('copies')
export class CopiesController {
  constructor(
    @Inject(CopiesService) private readonly copies: CopiesService,
    @Inject(ScopeService) private readonly scope: ScopeService,
  ) {}

  @Post()
  @RequirePermission('copy.create')
  create(@CurrentUser() me: AuthUser, @Body(zod(createCopiesBodySchema)) body: CreateCopiesBody, @Req() req: Request) {
    return this.copies.create(me, body, req.ip);
  }

  // Declared before ':id' so "by-code" is not captured as an id.
  @Get('by-code/:code')
  @RequirePermission('inventory.read', 'inventory.read.stall')
  async byCode(@CurrentUser() me: AuthUser, @Param('code') code: string) {
    return this.copies.getByCode(code, await this.scope.resolve(me));
  }

  @Get(':id')
  @RequirePermission('inventory.read', 'inventory.read.stall')
  async get(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string) {
    return this.copies.getById(id, await this.scope.resolve(me));
  }

  @Patch(':id')
  @RequirePermission('copy.update', 'copy.price.update')
  update(
    @CurrentUser() me: AuthUser,
    @Param('id', zod(uuidSchema)) id: string,
    @Body(zod(updateCopyBodySchema)) body: UpdateCopyBody,
    @Req() req: Request,
  ) {
    return this.copies.update(me, id, body, req.ip);
  }

  @Post(':id/write-off')
  @RequirePermission('copy.writeoff')
  writeOff(
    @CurrentUser() me: AuthUser,
    @Param('id', zod(uuidSchema)) id: string,
    @Body(zod(writeOffBodySchema)) body: WriteOffBody,
    @Req() req: Request,
  ) {
    return this.copies.writeOff(me.id, id, body, req.ip);
  }

  @Post(':id/move')
  @RequirePermission('copy.update')
  move(
    @CurrentUser() me: AuthUser,
    @Param('id', zod(uuidSchema)) id: string,
    @Body(zod(moveCopyBodySchema)) body: MoveCopyBody,
    @Req() req: Request,
  ) {
    return this.copies.move(me.id, id, body, req.ip);
  }
}
