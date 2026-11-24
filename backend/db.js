import 'dotenv/config';
import pg from 'pg';

export const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
  max: 12
});

export async function audit(queryable, actor, action, subject = null, detail = null) {
  await queryable.query(
    'INSERT INTO activity_logs(actor_id, action, subject, detail) VALUES ($1,$2,$3,$4)',
    [actor, action, subject, detail]
  );
}

export async function atomic(fn, client) {
  const connection = client || await db.connect();
  try {
    await connection.query('BEGIN');
    const value = await fn(connection);
    await connection.query('COMMIT');
    return value;
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (!client) connection.release();
  }
}
