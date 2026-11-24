import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';
import { atomic, audit, db } from './db.js';
import { currentUser, sha256 } from './auth.js';
import * as chain from './chain.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3, fieldSize: 512, parts: 5 }
});
export const pdfUpload = upload.single('file');
export const certificateId = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,63}$/,
  'Use 3–64 letters, digits or hyphens for the certificate ID.');
export const label = z.string().trim().min(2).max(160);

export async function validatePdf(file, required) {
  if (!file && !required) return;
  const bytes = file?.buffer;
  if (!bytes || file.mimetype !== 'application/pdf' || bytes.subarray(0, 5).toString() !== '%PDF-' ||
      !bytes.subarray(-1024).toString().trimEnd().endsWith('%%EOF')) {
    throw new HttpError(400, 'Upload a valid PDF file (up to 5 MB).');
  }
  try {
    const doc = await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
    if (!doc.getPageCount()) throw new Error('Empty PDF.');
  } catch {
    throw new HttpError(400, 'Upload a readable PDF with at least one page.');
  }
}

// Serialize privileged operations across API processes. Database rows survive a failed
// response or process exit, while PostgreSQL releases its advisory lock on disconnect.
export async function serialized(fn) {
  const client = await db.connect();
  let locked = false;
  let released = false;
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock(388275) AS locked');
    locked = rows[0].locked;
    if (!locked) throw new HttpError(409, 'Another registry update is in progress. Try again shortly.');
    return await fn(client);
  } finally {
    if (locked) {
      try { await client.query('SELECT pg_advisory_unlock(388275)'); }
      catch (error) { client.release(error); released = true; }
    }
    if (!released) client.release();
  }
}

export async function synchronize(client, row, actor, { submit = false } = {}) {
  const { id, digest, wallet } = row;
  let txHash = row.tx_hash;
  const startBlock = row.start_block;
  let ledger;
  let block;
  try {
    [block, ledger] = await chain.onChain(async () => {
      const height = await chain.confirmedBlock();
      return [height, await chain.record(id, height)];
    });
    if (ledger.issuer !== chain.ZeroAddress) {
      if (ledger.issuer.toLowerCase() !== wallet || ledger.digest !== digest) {
        await client.query("UPDATE certificates SET state='failed' WHERE registry=$1 AND id=$2",
          [chain.registryKey, id]);
        throw new HttpError(409, 'That ID is already registered with different certificate evidence.');
      }
      txHash = await chain.onChain(() => chain.registrationHash(id, startBlock, block));
    } else if (txHash) {
      const receipt = await chain.onChain(() => chain.receipt(txHash));
      if (!receipt || receipt.blockNumber > block) return { id, state: 'pending', transaction: txHash };
      if (receipt.status !== 0) return { id, state: 'pending', transaction: txHash };
      await client.query("UPDATE certificates SET state='failed',tx_hash=NULL WHERE registry=$1 AND id=$2",
        [chain.registryKey, id]);
      return { id, state: 'failed', transaction: txHash };
    } else if (submit) {
      const latest = await chain.onChain(() => chain.record(id, 'latest'));
      if (latest.issuer !== chain.ZeroAddress) return { id, state: 'pending', transaction: null };
      if (!await chain.onChain(() => chain.approved(wallet, 'latest'))) {
        throw new HttpError(403, 'The institution is disabled or awaiting approval.');
      }
      const tx = await chain.onChain(() => chain.issue(wallet, id, digest));
      txHash = tx.hash;
      await client.query('UPDATE certificates SET tx_hash=$3 WHERE registry=$1 AND id=$2',
        [chain.registryKey, id, txHash]);
      await chain.onChain(() => chain.wait(tx));
    } else {
      return { id, state: row.state, transaction: null };
    }
  } catch (error) {
    if (error instanceof chain.ChainError) return { id, state: 'pending', transaction: txHash };
    throw error;
  }
  await atomic(async connection => {
    await connection.query("UPDATE certificates SET state='confirmed',tx_hash=$3 WHERE registry=$1 AND id=$2",
      [chain.registryKey, id, txHash]);
    if (row.state !== 'confirmed') await audit(connection, actor, 'certificate.registered', id, txHash);
  }, client);
  return { id, state: 'confirmed', transaction: txHash, chainId: chain.networkInfo.chainId };
}

export async function register(req, user) {
  const fields = z.object({
    id: z.union([certificateId, z.literal('')]).optional(),
    holder: label, qualification: label
  }).parse(req.body);
  await validatePdf(req.file, true);
  const id = fields.id || 'TCS-' + randomUUID().toUpperCase();
  const digest = '0x' + sha256(req.file.buffer);
  return serialized(async client => {
    if (!await currentUser(req, client)) throw new HttpError(401, 'Your session is no longer active.');
    const block = await chain.onChain(chain.confirmedBlock);
    if (!await chain.onChain(() => chain.approved(user.wallet, block))) {
      throw new HttpError(403, 'The institution is disabled or awaiting approval.');
    }
    if ((await chain.onChain(() => chain.record(id, 'latest'))).issuer !== chain.ZeroAddress) {
      throw new HttpError(409, 'That certificate ID already exists.');
    }
    const row = await atomic(async connection => {
      const { rows } = await connection.query(
        `INSERT INTO certificates(id,registry,institution_id,holder,qualification,digest,document,start_block)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING
         RETURNING id,digest,start_block,tx_hash,state`,
        [id, chain.registryKey, user.institution_id, fields.holder, fields.qualification, digest, req.file.buffer, block]
      );
      if (!rows.length) throw new HttpError(409, 'That certificate ID already exists. Check your certificate records.');
      await audit(connection, user.id, 'certificate.staged', id);
      return { ...rows[0], wallet: user.wallet };
    }, client);
    return synchronize(client, row, user.id, { submit: true });
  });
}

export async function certificateFor(client, id, user) {
  const { rows } = await client.query(
    `SELECT c.id,c.institution_id,c.digest,c.start_block,c.tx_hash,c.state,i.wallet
     FROM certificates c JOIN institutions i ON i.id=c.institution_id WHERE c.registry=$1 AND c.id=$2`,
    [chain.registryKey, id]
  );
  if (!rows[0] || (user.role !== 'admin' && rows[0].institution_id !== user.institution_id)) {
    throw new HttpError(404, 'Certificate record not found.');
  }
  return rows[0];
}

export async function verify(id, file) {
  const block = await chain.onChain(chain.confirmedBlock);
  const ledger = await chain.onChain(() => chain.record(id, block));
  if (ledger.issuer === chain.ZeroAddress) {
    const pending = await db.query(
      "SELECT 1 FROM certificates WHERE registry=$1 AND id=$2 AND state='pending'", [chain.registryKey, id]);
    return { id, status: pending.rowCount ? 'unavailable' : 'not_found' };
  }
  const issuer = ledger.issuer.toLowerCase();
  const [{ rows }, enabled] = await Promise.all([
    db.query(
      `SELECT i.name,c.tx_hash FROM institutions i
       LEFT JOIN certificates c ON c.institution_id=i.id AND c.registry=$1 AND c.id=$2 AND c.digest=$3
       WHERE i.wallet=$4`, [chain.registryKey, id, ledger.digest, issuer]),
    chain.onChain(() => chain.approved(issuer, block))
  ]);
  const detail = { id, institution: rows[0]?.name, issuer, transaction: rows[0]?.tx_hash,
    registeredAt: new Date(Number(ledger.issuedAt) * 1000).toISOString(), issuerApproved: enabled,
    ...chain.networkInfo };
  if (ledger.revoked) return { ...detail, status: 'revoked' };
  if (!enabled || !rows.length) return { ...detail, status: enabled ? 'unavailable' : 'issuer_disabled' };
  if (!file) return { ...detail, status: 'registered' };
  return { ...detail, status: '0x' + sha256(file.buffer) === ledger.digest ? 'match' : 'mismatch' };
}
