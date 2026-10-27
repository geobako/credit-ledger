export default async function globalTeardown() {
  await globalThis.__PG_CONTAINER__?.stop();
}
