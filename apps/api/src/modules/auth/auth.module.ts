import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionCache } from './session-cache.service.js';
import { TokenService } from './token.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, SessionCache],
  exports: [AuthService, PasswordService, TokenService, SessionCache],
})
export class AuthModule {}
