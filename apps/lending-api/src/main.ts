import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ENV, Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.setGlobalPrefix('v1', { exclude: ['health', 'ready'] });
  app.enableShutdownHooks();

  const openApi = new DocumentBuilder()
    .setTitle('Acme Credit — Lending API')
    .setDescription(
      'Secured credit card lending: collateral, card activation, authorizations, repayments and closure.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, openApi));

  await app.listen(env.PORT);
}

void bootstrap();
