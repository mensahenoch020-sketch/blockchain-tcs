import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import multer from 'multer';
import QRCode from 'qrcode';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { atomic, audit, db } from './db.js';
import { cookieOptions, currentUser, email, hashPassword, password, sessionHash, sha256, validPassword } from './auth.js';
import * as chain from './chain.js';
import { certificateId, certificateFor, HttpError, label, pdfUpload, register, serialized,
  synchronize, validatePdf, verify } from './certificates.js';

const accountId = z.string().regex(/^[1-9][0-9]{0,17}$/);
const appOrigin = new URL(process.env.APP_ORIGIN || 'http://localhost:5173').origin;

function requireUser(role) {
  return async (req, _, next) => {
    req.user = await currentUser(req);
    if (!req.user) throw new HttpError(401, 'Sign in to continue.');
    if (role && req.user.role !== role) throw new HttpError(403, 'Your account cannot perform this action.');
    next();
  };
}

async function writableAccount(req, client) {
  if (!await currentUser(req, client)) throw new HttpError(401, 'Your session is no longer active.');
}

async function auditedWrite(client, user, action, id, send) {
  await audit(client, user.id, action + '.requested', id);
  const tx = await chain.onChain(send);
  await audit(client, user.id, action + '.submitted', id, tx.hash);
  try {
    const receipt = await chain.onChain(() => chain.wait(tx));
    await audit(client, user.id, action, id, receipt.hash);
    return { transaction: receipt.hash, state: 'confirmed' };
  } catch (error) {
    if (!(error instanceof chain.ChainError)) throw error;
    return { transaction: tx.hash, state: 'pending' };
  }
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:'],
    upgradeInsecureRequests: cookieOptions.secure ? [] : null } } }));
  app.get('/health', async (_, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await Promise.all([db.query('SELECT 1 FROM users LIMIT 1'), chain.confirmedBlock()]);
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== appOrigin) {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  const limit = (max, minutes) => rateLimit({ limit: max, windowMs: minutes * 60_000,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' } });
  app.use('/api', limit(300, 5));

  app.post('/api/auth/login', limit(12, 10), async (req, res) => {
    const body = z.object({ email, password: z.string().min(1).max(128) }).parse(req.body);
    const { rows } = await db.query('SELECT * FROM users WHERE email=$1', [body.email]);
    const user = rows[0];
    if (!await validPassword(body.password, user)) throw new HttpError(401, 'Email or password is incorrect.');
    const token = randomBytes(32).toString('hex');
    const duration = 8 * 60 * 60 * 1000;
    await atomic(async client => {
      await client.query('DELETE FROM sessions WHERE expires_at<=now() OR token_hash=$1', [sessionHash(req)]);
      await client.query('INSERT INTO sessions VALUES($1,$2,$3)', [sha256(token), user.id, new Date(Date.now() + duration)]);
      await audit(client, user.id, 'auth.login');
    });
    res.cookie('tcs_session', token, { ...cookieOptions, maxAge: duration }).json({ role: user.role });
  });
  app.get('/api/auth/me', requireUser(), (req, res) => res.json(req.user));
  app.post('/api/auth/logout', async (req, res) => {
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [sessionHash(req)]);
    res.clearCookie('tcs_session', cookieOptions).sendStatus(204);
  });

  app.get('/api/admin/institutions', requireUser('admin'), async (_, res) => {
    const { rows } = await db.query('SELECT * FROM institutions ORDER BY name');
    let approvals = null;
    let wallets = [];
    try {
      const block = await chain.onChain(chain.confirmedBlock);
      [approvals, wallets] = await chain.onChain(() => Promise.all([
        Promise.all(rows.map(row => chain.approved(row.wallet, block))), chain.localAccounts()
      ]));
    } catch (error) {
      if (!(error instanceof chain.ChainError)) throw error;
    }
    res.json({ institutions: rows.map((row, index) => ({ ...row, approved: approvals?.[index] ?? null })), wallets });
  });
  app.post('/api/admin/institutions', requireUser('admin'), async (req, res) => {
    const fields = z.object({ name: label, wallet: z.string().trim().regex(/^0x[a-fA-F0-9]{40}$/) }).parse(req.body);
    const wallet = fields.wallet.toLowerCase();
    if (!await chain.onChain(() => chain.supportedIssuer(wallet)) ||
        (await chain.onChain(chain.admin)).toLowerCase() === wallet) {
      throw new HttpError(400, 'Choose a configured issuer wallet distinct from the administrator wallet.');
    }
    const row = await atomic(async client => {
      const { rows } = await client.query('INSERT INTO institutions(name,wallet) VALUES($1,$2) RETURNING id',
        [fields.name, wallet]);
      await audit(client, req.user.id, 'institution.created', rows[0].id);
      return rows[0];
    });
    res.status(201).json(row);
  });
  app.patch('/api/admin/institutions/:id', requireUser('admin'), async (req, res) => {
    const id = accountId.parse(req.params.id);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const result = await serialized(async client => {
      await writableAccount(req, client);
      const { rows } = await client.query('SELECT wallet FROM institutions WHERE id=$1', [id]);
      if (!rows.length) throw new HttpError(404, 'Institution not found.');
      const wallet = rows[0].wallet;
      const action = enabled ? 'institution.approved' : 'institution.disabled';
      return auditedWrite(client, req.user, action, id, () => chain.setApproval(wallet, enabled));
    });
    res.status(result.state === 'confirmed' ? 200 : 202)
      .json({ ...result, approved: result.state === 'confirmed' ? enabled : null });
  });

  app.get('/api/admin/users', requireUser('admin'), async (_, res) => {
    const { rows } = await db.query(
      'SELECT u.id,u.email,u.role,u.enabled,i.name AS institution FROM users u LEFT JOIN institutions i ON i.id=u.institution_id ORDER BY u.email');
    res.json(rows);
  });
  app.post('/api/admin/users', requireUser('admin'), async (req, res) => {
    const fields = z.discriminatedUnion('role', [
      z.object({ role: z.literal('admin'), email, password }),
      z.object({ role: z.literal('issuer'), email, password, institution: accountId })
    ]).parse(req.body);
    const hash = await hashPassword(fields.password);
    const result = await atomic(async client => {
      const { rows } = await client.query(
        'INSERT INTO users(email,password_hash,role,institution_id) VALUES($1,$2,$3,$4) RETURNING id',
        [fields.email, hash, fields.role, fields.institution || null]);
      await audit(client, req.user.id, 'user.created', rows[0].id, fields.role);
      return rows[0];
    });
    res.status(201).json(result);
  });
  app.patch('/api/admin/users/:id', requireUser('admin'), async (req, res) => {
    const id = accountId.parse(req.params.id);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    if (req.user.id === id) throw new HttpError(400, 'You cannot change your own account status.');
    await serialized(async client => {
      await writableAccount(req, client);
      await atomic(async connection => {
        const updated = await connection.query('UPDATE users SET enabled=$2 WHERE id=$1', [id, enabled]);
        if (!updated.rowCount) throw new HttpError(404, 'User not found.');
        if (!enabled) await connection.query('DELETE FROM sessions WHERE user_id=$1', [id]);
        await audit(connection, req.user.id, enabled ? 'user.enabled' : 'user.disabled', id);
      }, client);
    });
    res.json({ enabled });
  });
  app.get('/api/admin/activity', requireUser('admin'), async (_, res) => {
    const { rows } = await db.query(
      `SELECT a.id,a.action,a.subject,a.detail,a.created_at,u.email AS actor
       FROM activity_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200`);
    res.json(rows);
  });
  app.get('/api/dashboard', requireUser(), async (req, res) => {
    const scope = req.user.role === 'admin' ? null : req.user.institution_id;
    const { rows } = await db.query(
      `SELECT (SELECT count(*)::int FROM certificates WHERE registry=$1 AND ($2::bigint IS NULL OR institution_id=$2)) AS total,
              (SELECT count(*)::int FROM certificates WHERE registry=$1 AND ($2::bigint IS NULL OR institution_id=$2) AND state='pending') AS pending,
              (SELECT count(*)::int FROM certificates WHERE registry=$1 AND ($2::bigint IS NULL OR institution_id=$2) AND state='confirmed') AS confirmed,
              (SELECT count(*)::int FROM institutions WHERE $2::bigint IS NULL) AS institutions,
              (SELECT count(*)::int FROM activity_logs WHERE $2::bigint IS NULL AND action='certificate.verified') AS verifications`,
      [chain.registryKey, scope]);
    let approved = null;
    if (scope) {
      try { approved = await chain.onChain(async () => chain.approved(req.user.wallet, await chain.confirmedBlock())); }
      catch (error) { if (!(error instanceof chain.ChainError)) throw error; }
    }
    res.json({ ...rows[0], approved, network: chain.networkInfo });
  });

  app.get('/api/certificates', requireUser(), async (req, res) => {
    const page = z.coerce.number().int().min(1).max(100000).parse(req.query.page || '1');
    const scope = req.user.role === 'admin' ? null : req.user.institution_id;
    const { rows } = await db.query(
      `SELECT c.id,c.holder,c.qualification,c.tx_hash,c.state,c.created_at,i.name AS institution
       FROM certificates c JOIN institutions i ON c.institution_id=i.id
       WHERE c.registry=$1 AND ($2::bigint IS NULL OR c.institution_id=$2)
       ORDER BY c.created_at DESC,c.id LIMIT 26 OFFSET $3`, [chain.registryKey, scope, (page - 1) * 25]);
    let block;
    try { block = await chain.onChain(chain.confirmedBlock); } catch (error) {
      if (!(error instanceof chain.ChainError)) throw error;
    }
    const items = await Promise.all(rows.slice(0,25).map(async row => {
      let status = null;
      if (block !== undefined && row.state === 'confirmed') {
        try {
          const record = await chain.onChain(() => chain.record(row.id, block));
          status = record.issuer === chain.ZeroAddress ? null : record.revoked ? 'revoked' : 'active';
        } catch (error) { if (!(error instanceof chain.ChainError)) throw error; }
      }
      return { ...row, status };
    }));
    res.json({ items, more: rows.length > 25, ...chain.networkInfo });
  });
  app.post('/api/certificates', requireUser('issuer'), limit(25, 5), pdfUpload, async (req, res) => {
    const result = await register(req, req.user);
    res.status(result.state === 'confirmed' ? 201 : 202).json(result);
  });
  app.post('/api/certificates/:id/synchronize', requireUser(), async (req, res) => {
    const id = certificateId.parse(req.params.id);
    const result = await serialized(async client => {
      await writableAccount(req, client);
      const row = await certificateFor(client, id, req.user);
      return synchronize(client, row, req.user.id, {
        submit: req.user.role === 'issuer' && req.query.check !== '1'
      });
    });
    res.status(result.state === 'pending' ? 202 : 200).json(result);
  });
  app.post('/api/certificates/:id/revoke', requireUser(), async (req, res) => {
    const id = certificateId.parse(req.params.id);
    const result = await serialized(async client => {
      await writableAccount(req, client);
      const row = await certificateFor(client, id, req.user);
      const actor = req.user.role === 'issuer' ? req.user.wallet : null;
      const block = await chain.onChain(chain.confirmedBlock);
      const record = await chain.onChain(() => chain.record(id, block));
      if (record.issuer.toLowerCase() !== row.wallet || record.digest !== row.digest || record.revoked) throw new HttpError(409, 'Certificate is missing or already revoked.');
      if (actor && !await chain.onChain(() => chain.approved(actor, block))) throw new HttpError(403, 'The institution is disabled.');
      return auditedWrite(client, req.user, 'certificate.revoked', id, () => chain.revoke(actor, id));
    });
    res.status(result.state === 'confirmed' ? 200 : 202)
      .json({ ...result, id, status: result.state === 'confirmed' ? 'revoked' : 'pending' });
  });
  app.get('/api/certificates/:id/qr', requireUser(), async (req, res) => {
    const id = certificateId.parse(req.params.id);
    const row = await certificateFor(db, id, req.user);
    if (row.state !== 'confirmed') throw new HttpError(409, 'Wait for registration confirmation.');
    const url = new URL('/verify/' + encodeURIComponent(id), appOrigin).href;
    res.type('png').send(await QRCode.toBuffer(url, { width: 320, margin: 2, errorCorrectionLevel: 'M' }));
  });

  app.post('/api/verify', limit(80, 5), pdfUpload, async (req, res) => {
    const id = certificateId.parse(req.body.id);
    await validatePdf(req.file, false);
    try {
      const result = await verify(id, req.file);
      await audit(db, null, 'certificate.verified', result.status === 'not_found' ? null : id, result.status);
      res.status(result.status === 'unavailable' ? 503 : 200).json(result);
    } catch (error) {
      console.error('Verification unavailable:', error.code || error.name);
      await audit(db, null, 'certificate.verified', null, 'unavailable').catch(() => {});
      res.status(503).json({ id, status: 'unavailable' });
    }
  });

  app.use('/api', (_, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  const build = resolve('frontend/dist');
  if (existsSync(build)) {
    app.use(express.static(build));
    app.get(/.*/, (_, res) => res.sendFile(resolve(build, 'index.html')));
  }
  app.use((error, _, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0].message });
    if (error instanceof multer.MulterError) return res.status(400).json({ error: 'Upload one PDF up to 5 MB.' });
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      return res.status(400).json({ error: 'Invalid or oversized request.' });
    }
    if (error.code === '23505') return res.status(409).json({ error: 'That record already exists.' });
    if (error.code === '23503') return res.status(400).json({ error: 'The associated record does not exist.' });
    if (error instanceof chain.ChainError) return res.status(503).json({
      error: 'Blockchain unavailable or confirmation pending. Refresh the record before retrying.'
    });
    console.error('API request failed:', error.code || error.name);
    return res.status(503).json({ error: 'Service temporarily unavailable. Please try again.' });
  });
  return app;
}
