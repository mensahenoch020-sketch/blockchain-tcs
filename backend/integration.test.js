import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { JsonRpcProvider } from 'ethers';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { samplePdf } from '../fixtures/generate.js';

assert.equal(process.env.CHAIN_ID, '31337', 'Integration tests require a disposable local Hardhat deployment.');
assert.equal(process.env.LOCAL_UNLOCKED_SIGNERS, 'true');
assert.ok(process.env.TEST_DATABASE_URL, 'Set TEST_DATABASE_URL to a dedicated disposable PostgreSQL database.');
assert.notEqual(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
const actualRpc = process.env.RPC_URL;
let rpcOffline = false;
let denyLogSearch = false;
const proxy = createServer(async (req, res) => {
  if (rpcOffline) return res.writeHead(500).end('Offline for integration test');
  const parts = [];
  for await (const chunk of req) parts.push(chunk);
  const body = Buffer.concat(parts);
  if (denyLogSearch && body.includes('"eth_getLogs"')) {
    return res.writeHead(500).end('Historical log search disabled for this test');
  }
  try {
    const upstream = await fetch(actualRpc, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body });
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' }).end(await upstream.text());
  } catch { res.writeHead(502).end(); }
});
async function listen(app) {
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  return 'http://127.0.0.1:' + app.address().port;
}

const rpc = await listen(proxy);
const origin = process.env.APP_ORIGIN;
process.env.RPC_URL = rpc;
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.ADMIN_EMAIL = 'test-' + randomUUID() + '@example.test';
process.env.ADMIN_PASSWORD = randomBytes(18).toString('hex');
process.env.DEMO_ISSUER_PASSWORD = '';
const bootstrap = spawn(process.execPath, ['backend/setup.js'], { stdio: 'inherit' });
assert.equal((await once(bootstrap, 'close'))[0], 0);
const { createApp } = await import('./app.js');
const { db } = await import('./db.js');
const chain = await import('./chain.js');
const server = createServer(createApp());
const base = await listen(server);
const original = await samplePdf();
const modified = await samplePdf('Modified qualification');
const unique = randomUUID().toUpperCase();
const id = 'TEST-' + unique;
const recoveryId = 'RECOVERY-' + unique;
const pendingId = 'PENDING-' + unique;
const credentials = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
const rpcClient = new JsonRpcProvider(actualRpc);
let adminCookie, issuerCookie, institution, issuer, wallet, transaction;

async function api(path, method = 'GET', body, cookie, requestOrigin = origin) {
  const form = body instanceof FormData;
  const response = await fetch(base + '/api' + path, { method, body: form ? body : body ? JSON.stringify(body) : undefined,
    headers: { Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}),
      ...(body && !form ? { 'Content-Type': 'application/json' } : {}) } });
  const content = response.headers.get('content-type');
  return { status: response.status, headers: response.headers,
    data: content?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}

const cookieOf = response => response.headers.get('set-cookie').split(';')[0];
function upload(certificate, bytes, type = 'application/pdf') {
  const data = new FormData();
  data.set('id', certificate);
  data.set('holder', 'Sample Graduate');
  data.set('qualification', 'Telecommunication Science');
  data.set('file', new Blob([bytes], { type }), 'certificate.pdf');
  return data;
}
const check = (certificate, bytes) => api('/verify', 'POST', bytes ? upload(certificate, bytes) : { id: certificate });

test('Real Express, PostgreSQL and Hardhat workflow', async t => {
  t.after(async () => {
    if (wallet && await chain.approved(wallet, 'latest')) await chain.wait(await chain.setApproval(wallet, false));
    await db.end();
    rpcClient.destroy();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => proxy.close(resolve))]);
  });

  await t.test('administrator authentication, session cookie and origin check', async () => {
    assert.equal((await api('/auth/login', 'POST', { ...credentials, password: 'wrong' })).status, 401);
    assert.equal((await api('/auth/login', 'POST', credentials, null, 'https://example.invalid')).status, 403);
    const login = await api('/auth/login', 'POST', credentials);
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /HttpOnly.*SameSite=Strict/);
    adminCookie = cookieOf(login);
    assert.equal((await api('/auth/me', 'GET', null, adminCookie)).data.role, 'admin');
  });

  await t.test('institution creation, staff accounts and restricted approval', async () => {
    const available = (await api('/admin/institutions', 'GET', null, adminCookie)).data.wallets;
    wallet = available.at(-1);
    const name = 'Integration ' + unique;
    const result = await api('/admin/institutions', 'POST', { name, wallet }, adminCookie);
    if (result.status === 409) {
      institution = (await api('/admin/institutions', 'GET', null, adminCookie)).data.institutions.find(i =>
        i.wallet === wallet.toLowerCase()).id;
    } else {
      assert.equal(result.status, 201);
      institution = result.data.id;
    }
    const account = { email: 'issuer-' + unique.toLowerCase() + '@example.test',
      password: randomBytes(18).toString('hex'), role: 'issuer', institution };
    const created = await api('/admin/users', 'POST', account, adminCookie);
    assert.equal(created.status, 201);
    issuer = created.data.id;
    issuerCookie = cookieOf(await api('/auth/login', 'POST', account));
    assert.equal((await api('/admin/institutions/' + institution, 'PATCH', { enabled: true }, issuerCookie)).status, 403);
    assert.equal((await api('/certificates', 'POST', upload(id, original))).status, 401);
    assert.equal((await api('/certificates', 'POST', upload(id, original), adminCookie)).status, 403);
    assert.equal((await api('/certificates', 'POST', upload(id, original), issuerCookie)).status, 403);
    assert.equal((await api('/admin/institutions/' + institution, 'PATCH', { enabled: true }, adminCookie)).status, 200);
  });

  await t.test('invalid upload and missing fields', async () => {
    assert.equal((await api('/certificates', 'POST', upload(id, original, 'text/plain'), issuerCookie)).status, 400);
    assert.equal((await api('/certificates', 'POST', upload(id, 'malformed'), issuerCookie)).status, 400);
    assert.equal((await api('/certificates', 'POST', { id }, issuerCookie)).status, 400);
  });

  await t.test('confirmed registration, duplicates, QR and public ID-only lookup', async () => {
    const response = await api('/certificates', 'POST', upload(id, original), issuerCookie);
    assert.equal(response.status, 201, JSON.stringify(response.data));
    assert.equal(response.data.state, 'confirmed');
    transaction = response.data.transaction;
    assert.equal((await rpcClient.getTransactionReceipt(transaction)).status, 1);
    assert.equal((await api('/certificates', 'POST', upload(id, original), issuerCookie)).status, 409);
    const qr = await api('/certificates/' + id + '/qr', 'GET', null, issuerCookie);
    assert.equal(qr.headers.get('content-type'), 'image/png');
    const image = PNG.sync.read(qr.data);
    const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
    assert.equal(decoded?.data, origin + '/verify/' + id);
    const lookup = await check(id);
    assert.equal(lookup.data.status, 'registered');
    assert.equal(lookup.data.transaction, transaction);
    assert.equal(lookup.data.holder, undefined);
    assert.equal(lookup.data.document, undefined);
  });

  await t.test('exact original, byte-for-byte copy, edited PDF and unknown ID', async () => {
    assert.equal((await check(id, original)).data.status, 'match');
    assert.equal((await check(id, Buffer.from(original))).data.status, 'match');
    assert.equal((await check(id, modified)).data.status, 'mismatch');
    assert.equal((await check('UNKNOWN-' + unique)).data.status, 'not_found');
  });

  await t.test('pending transaction waits for mining then synchronizes', async () => {
    await rpcClient.send('evm_setAutomine', [false]);
    try {
      const result = await api('/certificates', 'POST', upload(pendingId, original), issuerCookie);
      assert.equal(result.status, 202);
      assert.equal(result.data.state, 'pending');
      assert.match(result.data.transaction, /^0x[0-9a-f]{64}$/);
      assert.equal((await check(pendingId)).data.status, 'unavailable');
      await rpcClient.send('evm_mine', []);
    } finally {
      await rpcClient.send('evm_setAutomine', [true]);
    }
    denyLogSearch = true;
    try {
      const result = await api('/certificates/' + pendingId + '/synchronize', 'POST', null, issuerCookie);
      assert.equal(result.data.state, 'confirmed');
    } finally {
      denyLogSearch = false;
    }
  });

  await t.test('RPC outage returns Unable to Verify and stops new registration', async () => {
    assert.equal((await fetch(base + '/health')).status, 200);
    rpcOffline = true;
    try {
      assert.equal((await fetch(base + '/health')).status, 503);
      const result = await check(id);
      assert.equal(result.status, 503);
      assert.equal(result.data.status, 'unavailable');
      assert.equal((await api('/certificates', 'POST', upload('OFFLINE-' + unique, original), issuerCookie)).status, 503);
    } finally { rpcOffline = false; }
  });

  await t.test('database finalization failure recovers confirmed transaction from Ethereum', async () => {
    await db.query(`CREATE FUNCTION test_reject_confirmation() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN IF NEW.state = 'confirmed' THEN RAISE EXCEPTION 'test DB write error'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER test_reject_confirmation BEFORE UPDATE ON certificates FOR EACH ROW EXECUTE FUNCTION test_reject_confirmation();`);
    try {
      const failure = await api('/certificates', 'POST', upload(recoveryId, original), issuerCookie);
      assert.equal(failure.status, 503);
      const staged = (await db.query('SELECT state,tx_hash FROM certificates WHERE id=$1', [recoveryId])).rows[0];
      assert.equal(staged.state, 'pending');
      assert.equal((await rpcClient.getTransactionReceipt(staged.tx_hash)).status, 1);
      // Model a process loss before saving the broadcast hash as well.
      await db.query('UPDATE certificates SET tx_hash=NULL WHERE id=$1', [recoveryId]);
    } finally {
      await db.query('DROP TRIGGER test_reject_confirmation ON certificates; DROP FUNCTION test_reject_confirmation()');
    }
    const recovered = await api('/certificates/' + recoveryId + '/synchronize', 'POST', null, issuerCookie);
    assert.equal(recovered.data.state, 'confirmed');
    assert.equal((await rpcClient.getTransactionReceipt(recovered.data.transaction)).status, 1);
    assert.equal((await check(recoveryId, original)).data.status, 'match');
  });

  await t.test('issuer disable, administrator revocation, and audit precedence', async () => {
    assert.equal((await api('/admin/institutions/' + institution, 'PATCH', { enabled: false }, adminCookie)).status, 200);
    assert.equal((await check(id, original)).data.status, 'issuer_disabled');
    assert.equal((await api('/certificates/' + id + '/revoke', 'POST', null, issuerCookie)).status, 403);
    assert.equal((await api('/certificates/' + id + '/revoke', 'POST', null, adminCookie)).status, 200);
    assert.equal((await check(id, original)).data.status, 'revoked');
    assert.equal((await check(id, modified)).data.status, 'revoked');
    const activity = await api('/admin/activity', 'GET', null, adminCookie);
    assert.ok(activity.data.some(row => row.action === 'certificate.revoked' && row.subject === id));
    assert.ok(activity.data.some(row => row.action === 'certificate.verified' && row.detail === 'mismatch'));
  });

  await t.test('user disabling invalidates the existing session and logout removes the administrator session', async () => {
    assert.equal((await api('/admin/users/' + issuer, 'PATCH', { enabled: false }, adminCookie)).status, 200);
    assert.equal((await api('/auth/me', 'GET', null, issuerCookie)).status, 401);
    assert.equal((await api('/auth/logout', 'POST', null, adminCookie)).status, 204);
    assert.equal((await api('/auth/me', 'GET', null, adminCookie)).status, 401);
  });
});
