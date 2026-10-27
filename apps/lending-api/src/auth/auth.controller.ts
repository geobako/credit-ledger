import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '../database/schema';
import { UnauthenticatedError } from './auth.errors';
import { DemoLoginDto, RegisterDto } from './auth.dto';
import { CurrentPrincipal, Public, SignInRateLimited } from './decorators';
import { Principal } from './principal';
import { TokenService } from './token.service';
import { UsersService } from './users.service';

const toPrincipal = (user: User): Principal => ({
  userId: user.id,
  email: user.email,
  role: user.role,
});

/**
 * Simulated identity provider endpoints. Login is passwordless on purpose: the brief
 * allows a simulated auth service, and a real deployment delegates to an external IdP.
 */
@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @SignInRateLimited()
  @Post('auth/register')
  @ApiOperation({ summary: 'Register a customer (simulated IdP)' })
  async register(@Body() dto: RegisterDto) {
    const user = await this.users.registerCustomer(dto.email, dto.name);
    return { user: present(user), ...this.tokens.issue(toPrincipal(user)) };
  }

  @Public()
  @SignInRateLimited()
  @Post('auth/demo-login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in as an existing demo user (simulated IdP, passwordless)' })
  async demoLogin(@Body() dto: DemoLoginDto) {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new UnauthenticatedError('unknown user');
    return { user: present(user), ...this.tokens.issue(toPrincipal(user)) };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in user' })
  async me(@CurrentPrincipal() principal: Principal) {
    return present(await this.users.get(principal.userId));
  }
}

function present(user: User) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
