import { createHash, randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';
import { z } from 'zod';

const scrypt = promisify(derive);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const password = z.string().min(12).max(128);
export const cookieOptions = {
  httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/api'
};

export async function hashPassword(value) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await scrypt(value, salt, 64)).toString('hex');
}

export async function validPassword(value, row) {
  const [salt, expected] = (row?.password_hash || '0'.repeat(32) + ':' + '0'.repeat(128)).split(':');
  const digest = await scrypt(value, salt, 64);
  return timingSafeEqual(digest, Buffer.from(expected, 'hex')) && Boolean(row?.enabled);
}

export function sessionHash(req) {
  const token = req.headers.cookie?.match(/(?:^|;\s*)tcs_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  return token ? sha256(token) : null;
}

export async function currentUser(req, client = db) {
  const token = sessionHash(req);
  if (!token) return null;
  const { rows } = await client.query(
    `SELECT u.id,u.email,u.role,u.institution_id,i.name AS institution,i.wallet
     FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN institutions i ON i.id=u.institution_id
     WHERE s.token_hash=$1 AND s.expires_at>now() AND u.enabled`, [token]
  );
  return rows[0] || null;
}
