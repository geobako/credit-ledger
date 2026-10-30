import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Inject } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { User } from '../database/schema';
import { InvalidRefreshTokenError, MissingCsrfHeaderError } from './auth.errors';
import { LoginDto, RegisterDto } from './auth.dto';
import { AuthService, SignedIn } from './auth.service';
import { CurrentPrincipal, Public, SignInRateLimited } from './decorators';
import { Principal } from './principal';
import { UsersService } from './users.service';

export const REFRESH_COOKIE = 'acme_refresh';
/** Any custom header forces a CORS preflight, so other sites cannot send it with our cookie. */
export const CSRF_HEADER = 'x-csrf-protection';

/**
 * Sessions: a short-lived access token in the response body (the client keeps it in memory
 * only) and a rotating refresh token in an httpOnly, SameSite=Strict cookie that JavaScript
 * cannot read.
 */
@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @SignInRateLimited()
  @Post('auth/register')
  @ApiOperation({ summary: 'Create a customer account and start a session' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.register(dto.email, dto.name, dto.password));
  }

  @Public()
  @SignInRateLimited()
  @Post('auth/login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(dto.email, dto.password));
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Protection', required: true })
  @ApiOperation({ summary: 'Exchange the refresh cookie for a new access token (rotates it)' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    requireCsrfHeader(req);
    const token = readCookie(req, REFRESH_COOKIE);
    if (!token) throw new InvalidRefreshTokenError('no session');
    try {
      return this.respond(res, await this.auth.refresh(token));
    } catch (error) {
      // A dead session clears its cookie; a superseded one keeps the newer cookie already set.
      if (error instanceof InvalidRefreshTokenError) this.clearCookie(res);
      throw error;
    }
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(204)
  @ApiHeader({ name: 'X-CSRF-Protection', required: true })
  @ApiOperation({ summary: 'End the session (revokes its refresh tokens)' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    requireCsrfHeader(req);
    const token = readCookie(req, REFRESH_COOKIE);
    if (token) await this.auth.logout(token);
    this.clearCookie(res);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in user' })
  async me(@CurrentPrincipal() principal: Principal) {
    return present(await this.users.get(principal.userId));
  }

  private respond(res: Response, signedIn: SignedIn) {
    res.cookie(REFRESH_COOKIE, signedIn.refreshToken.token, {
      ...this.cookieOptions(),
      maxAge: signedIn.refreshToken.maxAge * 1000,
    });
    res.setHeader('Cache-Control', 'no-store');
    return {
      user: present(signedIn.user),
      accessToken: signedIn.accessToken,
      expiresIn: signedIn.expiresIn,
    };
  }

  private clearCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      // Browsers treat http://localhost as secure, but not every one; HTTPS is mandatory in
      // production, so Secure is always set there.
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      path: this.env.REFRESH_COOKIE_PATH,
    };
  }
}

function requireCsrfHeader(req: Request) {
  if (req.headers[CSRF_HEADER] !== '1') {
    throw new MissingCsrfHeaderError(`the ${CSRF_HEADER} header is required`);
  }
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function present(user: User) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
