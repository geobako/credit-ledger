import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { TokenService } from './token.service';
import { UsersService } from './users.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    TokenService,
    UsersService,
    SessionsService,
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokenService, UsersService],
})
export class AuthModule {}
