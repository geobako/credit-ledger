import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { users } from './schema';

/** Demo identities for the simulated IdP. Fixed ids keep links and docs stable. */
export const DEMO_USERS = [
  {
    id: '00000000-0000-4000-8000-00000000a11c',
    email: 'alice@acme.test',
    name: 'Alice Customer',
    role: 'customer',
  },
  {
    id: '00000000-0000-4000-8000-000000000b0b',
    email: 'bob@acme.test',
    name: 'Bob Customer',
    role: 'customer',
  },
  {
    id: '00000000-0000-4000-8000-0000000000a5',
    email: 'ops@acme.test',
    name: 'Olivia Ops',
    role: 'ops',
  },
] as const;

export async function seedDemoData(databaseUrl: string) {
  const client = new Client({ connectionString: databaseUrl, application_name: 'seed' });
  await client.connect();
  try {
    await drizzle(client)
      .insert(users)
      .values([...DEMO_USERS])
      .onConflictDoNothing();
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  seedDemoData(url).then(
    () => console.log(`seeded ${DEMO_USERS.length} demo users`),
    (error: unknown) => {
      console.error('seed failed', error);
      process.exit(1);
    },
  );
}
