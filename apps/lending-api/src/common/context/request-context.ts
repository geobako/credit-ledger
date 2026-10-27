import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

export type Actor =
  | { type: 'user'; id: string; role: string }
  | { type: 'service'; id: string }
  | { type: 'provider'; id: string }
  | { type: 'system'; id: string };

interface Store {
  requestId: string;
  actor?: Actor;
}

const storage = new AsyncLocalStorage<Store>();

/**
 * Who is acting and under which request id, available anywhere in the call chain without
 * threading it through every signature. Background jobs run outside a request and are
 * attributed to the system.
 */
export const RequestContext = {
  middleware: (req: Request, _res: Response, next: NextFunction): void => {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
    // Normalise the header so the HTTP logger picks up the same id.
    req.headers[REQUEST_ID_HEADER] = requestId;
    storage.run({ requestId }, next);
  },

  run<T>(actor: Actor, work: () => T): T {
    return storage.run({ requestId: randomUUID(), actor }, work);
  },

  setActor(actor: Actor) {
    const store = storage.getStore();
    if (store) store.actor = actor;
  },

  actor(): Actor {
    return storage.getStore()?.actor ?? { type: 'system', id: 'lending-api' };
  },

  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};
