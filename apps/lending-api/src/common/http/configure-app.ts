import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ENV, Env } from '../../config/env';
import { ProblemFilter } from './problem.filter';

/** HTTP setup shared by the real bootstrap and the integration tests. */
export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors({
    origin: env.WEB_ORIGINS,
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'],
  });
  app.setGlobalPrefix('v1', { exclude: ['health', 'ready'] });
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
