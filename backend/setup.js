import { readFile, readdir } from 'node:fs/promises';
import { atomic, db } from './db.js';
import { email, hashPassword, password } from './auth.js';

try {
  const directory = new URL('./migrations/', import.meta.url);
  await atomic(async client => {
    await client.query("SELECT pg_advisory_xact_lock(388274)");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY)');
    for (const name of (await readdir(directory)).sort()) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
      if (applied.rowCount) continue;
      await client.query(await readFile(new URL(name, directory), 'utf8'));
      await client.query('INSERT INTO schema_migrations VALUES ($1)', [name]);
    }
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      const address = email.parse(process.env.ADMIN_EMAIL);
      const hash = await hashPassword(password.parse(process.env.ADMIN_PASSWORD));
      await client.query(`INSERT INTO users(email,password_hash,role) VALUES ($1,$2,'admin')
                          ON CONFLICT(email) DO NOTHING`, [address, hash]);
    }
    if (process.env.DEMO_ISSUER_PASSWORD) {
      const { localAccounts } = await import('./chain.js');
      const wallet = (await localAccounts())[0];
      if (!wallet) throw new Error('Demo seed requires the local Hardhat network.');
      const institution = await client.query(
        `INSERT INTO institutions(name,wallet) VALUES ('University of Ilorin · Demo',$1)
         ON CONFLICT(wallet) DO UPDATE SET wallet=EXCLUDED.wallet RETURNING id`, [wallet.toLowerCase()]
      );
      await client.query(`INSERT INTO users(email,password_hash,role,institution_id)
        VALUES ($1,$2,'issuer',$3) ON CONFLICT(email) DO NOTHING`,
      [email.parse(process.env.DEMO_ISSUER_EMAIL), await hashPassword(password.parse(process.env.DEMO_ISSUER_PASSWORD)),
        institution.rows[0].id]);
    }
  });
  console.log('Migrations and configured seed complete.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.end();
}
