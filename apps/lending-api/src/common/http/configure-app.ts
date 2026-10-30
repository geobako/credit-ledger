import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ENV, Env } from '../../config/env';
import { Metrics } from '../../metrics/metrics';
import { RequestContext } from '../context/request-context';
import { ProblemFilter } from './problem.filter';

/** HTTP setup shared by the real bootstrap and the integration tests. */
export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  // Before everything else, so every log line and audit entry shares the request id.
  app.use(RequestContext.middleware);
  const metrics = app.get(Metrics);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const stop = metrics.httpRequestDuration.startTimer();
    res.on('finish', () => {
      // Route template (/v1/cards/:cardId/freeze), never the raw URL: keeps label cardinality bounded.
      const route = req.route
        ? `${req.baseUrl}${(req.route as { path: string }).path}`
        : 'unmatched';
      stop({ method: req.method, route, status: String(res.statusCode) });
    });
    next();
  });
  app.use(helmet());
  app.enableCors({
    origin: env.WEB_ORIGINS,
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Request-Id',
      'X-CSRF-Protection',
    ],
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'],
  });
  app.setGlobalPrefix('v1', { exclude: ['health', 'ready', 'metrics'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();

  const openApi = new DocumentBuilder()
    .setTitle('Acme Credit — Lending API')
    .setDescription(
      'Secured credit card lending: collateral, card activation, authorizations, repayments and closure.\n\n' +
        'Amounts are integer minor units (cents) encoded as strings. Mutating endpoints require an `Idempotency-Key` header.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, openApi));
}
