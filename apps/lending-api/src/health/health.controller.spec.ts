import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DB } from '../database/database.module';
import { HealthController } from './health.controller';

function dbStub(fails: boolean) {
  return {
    getExecutor: () => ({
      transformQuery: (node: unknown) => node,
      compileQuery: () => ({ sql: 'select 1', parameters: [] }),
      executeQuery: () =>
        fails ? Promise.reject(new Error('down')) : Promise.resolve({ rows: [] }),
    }),
  };
}

async function controllerWith(fails: boolean) {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: DB, useValue: dbStub(fails) }],
  }).compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('reports liveness without touching the database', async () => {
    const controller = await controllerWith(true);
    expect(controller.health()).toEqual({ status: 'ok' });
  });

  it('is ready when the database answers', async () => {
    const controller = await controllerWith(false);
    await expect(controller.ready()).resolves.toEqual({
      status: 'ready',
      checks: { database: 'up' },
    });
  });

  it('is not ready when the database is down', async () => {
    const controller = await controllerWith(true);
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
