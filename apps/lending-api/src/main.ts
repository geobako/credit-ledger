import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './common/http/configure-app';
import { ENV, Env } from './config/env';

async function bootstrap() {
  // rawBody: webhook signatures are computed over the exact bytes received.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  configureApp(app);
  await app.listen(app.get<Env>(ENV).PORT);
}

void bootstrap();
