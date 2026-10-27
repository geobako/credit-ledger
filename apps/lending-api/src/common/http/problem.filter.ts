import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError, DomainErrorKind } from '../errors/domain-error';

const STATUS_BY_KIND: Record<DomainErrorKind, number> = {
  validation: HttpStatus.BAD_REQUEST,
  not_found: HttpStatus.NOT_FOUND,
  forbidden: HttpStatus.FORBIDDEN,
  conflict: HttpStatus.CONFLICT,
  unprocessable: HttpStatus.UNPROCESSABLE_ENTITY,
  unauthenticated: HttpStatus.UNAUTHORIZED,
  invariant: HttpStatus.INTERNAL_SERVER_ERROR,
};

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  details?: Record<string, unknown>;
  requestId?: string;
}

/**
 * Every error leaves the service as RFC 9457 problem+json with a stable `code`.
 * Unexpected errors are logged in full and returned without internals.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const problem = this.toProblem(exception);
    problem.requestId = typeof req.id === 'string' ? req.id : undefined;

    if (problem.status >= 500) {
      this.logger.error({ err: exception, requestId: problem.requestId }, 'unhandled error');
    }
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown): Problem {
    if (exception instanceof DomainError) {
      const status = STATUS_BY_KIND[exception.kind];
      return {
        type: `urn:acme-credit:error:${exception.code}`,
        title: titleFor(status),
        status,
        code: exception.code,
        // Invariant violations are bugs; their messages may reveal internals.
        detail: exception.kind === 'invariant' ? 'Internal error' : exception.message,
        details: exception.kind === 'invariant' ? undefined : exception.details,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string' ? body : (body as { message?: string | string[] }).message;
      const detail = Array.isArray(message) ? message.join('; ') : (message ?? exception.message);
      const code = HttpStatus[status] ?? 'HTTP_ERROR';
      return {
        type: `urn:acme-credit:error:${code}`,
        title: titleFor(status),
        status,
        code,
        detail,
      };
    }
    return {
      type: 'urn:acme-credit:error:INTERNAL',
      title: titleFor(500),
      status: 500,
      code: 'INTERNAL',
      detail: 'Internal error',
    };
  }
}

function titleFor(status: number): string {
  return (HttpStatus[status] ?? 'ERROR')
    .toLowerCase()
    .split('_')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}
