import { Module } from '@nestjs/common';
import { CredentialSlipService } from './credential-slip.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({ controllers: [UsersController], providers: [UsersService, CredentialSlipService], exports: [UsersService] })
export class UsersModule {}
