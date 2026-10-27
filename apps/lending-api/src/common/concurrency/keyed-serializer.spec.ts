import { KeyedSerializer, SerializerQueueFullError } from './keyed-serializer';

const tick = () => new Promise((r) => setImmediate(r));

describe('KeyedSerializer', () => {
  it('runs tasks for one key strictly one at a time, in order', async () => {
    const serializer = new KeyedSerializer(100);
    let running = 0;
    let maxRunning = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        serializer.run('a', async () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await tick();
          order.push(i);
          running--;
        }),
      ),
    );
    expect(maxRunning).toBe(1);
    expect(order).toEqual([...Array(20).keys()]);
    expect(serializer.activeKeys).toBe(0);
  });

  it('runs different keys in parallel', async () => {
    const serializer = new KeyedSerializer(100);
    let running = 0;
    let maxRunning = 0;
    await Promise.all(
      ['a', 'b', 'c'].map((key) =>
        serializer.run(key, async () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await tick();
          running--;
        }),
      ),
    );
    expect(maxRunning).toBe(3);
  });

  it('keeps going after a task fails', async () => {
    const serializer = new KeyedSerializer(100);
    const failed = serializer.run('a', () => Promise.reject(new Error('boom')));
    const next = serializer.run('a', () => Promise.resolve('ok'));
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('sheds load beyond the queue depth', async () => {
    const serializer = new KeyedSerializer(2);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = serializer.run('a', () => gate);
    const second = serializer.run('a', () => Promise.resolve());
    await expect(serializer.run('a', () => Promise.resolve())).rejects.toBeInstanceOf(
      SerializerQueueFullError,
    );
    release();
    await Promise.all([first, second]);
    await expect(serializer.run('a', () => Promise.resolve('again'))).resolves.toBe('again');
  });
});
