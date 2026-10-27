import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { TokenService } from './token.service';
import { UsersService } from './users.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [TokenService, UsersService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [TokenService, UsersService],
})
export class AuthModule {}
