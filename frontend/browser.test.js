import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { test } from 'node:test';
import { samplePdf } from '../fixtures/generate.js';

test('Built application supports staff issuance and anonymous mobile verification', async t => {
  assert.equal(process.env.CHAIN_ID, '31337');
  assert.equal(process.env.LOCAL_UNLOCKED_SIGNERS, 'true');
  assert.ok(process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL,
    'Set TEST_DATABASE_URL to a dedicated disposable database.');
  const id = 'BROWSER-' + randomUUID().toUpperCase();
  const adminEmail = id.toLowerCase() + '-admin@example.test';
  const issuerEmail = id.toLowerCase() + '-issuer@example.test';
  const password = randomBytes(18).toString('hex');
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  process.env.APP_ORIGIN = origin;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.ADMIN_EMAIL = adminEmail;
  process.env.ADMIN_PASSWORD = password;
  process.env.DEMO_ISSUER_PASSWORD = '';
  const seed = spawn(process.execPath, ['backend/setup.js'], { stdio: 'inherit' });
  assert.equal((await once(seed, 'close'))[0], 0);
  const { createApp } = await import('../backend/app.js');
  const { db } = await import('../backend/db.js');
  const chain = await import('../backend/chain.js');
  server.on('request', createApp());
  let browser;
  let wallet;
  t.after(async () => {
    try {
      await browser?.close();
      if (wallet && await chain.approved(wallet, 'latest')) await chain.wait(await chain.setApproval(wallet, false));
    } finally {
      await db.end();
      await new Promise(resolve => server.close(resolve));
    }
  });

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const scriptErrors = [];
  desktop.on('pageerror', error => scriptErrors.push(error.message));
  const expectText = async (page, text) => page.getByText(text, { exact: true }).first().waitFor();
  async function signIn(address) {
    await desktop.getByRole('link', { name: 'Staff sign in' }).click();
    await desktop.getByLabel('Email address').fill(address);
    await desktop.getByLabel('Password').fill(password);
    await desktop.getByRole('button', { name: 'Sign in' }).click();
  }

  await desktop.goto(origin);
  await desktop.getByRole('heading', { name: /Verify academic certificates online/ }).waitFor();
  if (process.env.BROWSER_SCREENSHOT) await desktop.screenshot({ path: process.env.BROWSER_SCREENSHOT, fullPage: true });
  await signIn(adminEmail);
  await desktop.getByRole('heading', { name: 'Administrator dashboard' }).waitFor();
  await desktop.getByRole('link', { name: 'Institutions' }).click();
  wallet = (await chain.localAccounts()).at(-2);
  const known = (await db.query('SELECT name FROM institutions WHERE wallet=$1', [wallet.toLowerCase()])).rows[0];
  const institution = known?.name || 'Browser Test ' + id;
  if (!known) {
    await desktop.getByLabel('Institution name').fill(institution);
    await desktop.getByLabel('Issuer wallet').fill(wallet);
    await desktop.getByRole('button', { name: 'Add institution' }).click();
    await expectText(desktop, 'Institution added. Approve it to enable issuance.');
  }
  const institutionRow = desktop.getByRole('row').filter({ hasText: institution });
  await institutionRow.waitFor();
  const approval = institutionRow.getByRole('button', { name: 'Approve', exact: true });
  if (await approval.isVisible()) await approval.click();
  await institutionRow.getByText('Approved', { exact: true }).waitFor();

  await desktop.getByRole('link', { name: 'Users' }).click();
  await desktop.getByLabel('Email', { exact: true }).fill(issuerEmail);
  await desktop.getByLabel('Initial password').fill(password);
  await desktop.getByLabel('Institution', { exact: true }).selectOption({ label: institution });
  await desktop.getByRole('button', { name: 'Create account' }).click();
  await expectText(desktop, 'Account created.');
  await desktop.getByRole('button', { name: 'Sign out' }).click();
  await signIn(issuerEmail);
  await desktop.getByRole('heading', { name: 'Institution dashboard' }).waitFor();
  await desktop.getByRole('link', { name: 'Register certificate' }).first().click();
  const original = Buffer.from(await samplePdf());
  const modified = Buffer.from(await samplePdf('Edited qualification'));
  const file = buffer => ({ name: 'certificate.pdf', mimeType: 'application/pdf', buffer });
  await desktop.getByLabel('Certificate ID (optional)').fill(id);
  await desktop.getByLabel('Certificate holder').fill('Sample Graduate');
  await desktop.getByLabel('Qualification').fill('Telecommunication Science');
  await desktop.locator('input[type=file]').setInputFiles(file(original));
  await desktop.route('**/api/certificates', async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 201);
    const confirmed = await response.json();
    // Present the response Sepolia sends after broadcast and exercise real reconciliation.
    await route.fulfill({ response, status: 202, json: { ...confirmed, state: 'pending' } });
  }, { times: 1 });
  await desktop.getByRole('button', { name: 'Register on Ethereum' }).click();
  await expectText(desktop, 'Registration pending');
  await expectText(desktop, 'Registration confirmed');
  await desktop.getByRole('link', { name: 'View record and QR code' }).click();
  await desktop.getByRole('button', { name: 'QR code' }).first().click();
  const qr = desktop.getByRole('img', { name: 'Verification QR code for ' + id });
  await qr.waitFor();
  await qr.evaluate(image => image.decode());
  const verifyUrl = await desktop.getByRole('link', { name: 'Open verification' }).getAttribute('href');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true,
    hasTouch: true, deviceScaleFactor: 1 });
  mobile.on('pageerror', error => scriptErrors.push(error.message));
  await mobile.goto(origin + verifyUrl);
  await expectText(mobile, 'Registered · Active');
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.locator('input[type=file]').setInputFiles(file(original));
  await mobile.getByRole('button', { name: 'Check certificate' }).click();
  await expectText(mobile, 'Verified File Match');
  await mobile.locator('input[type=file]').setInputFiles(file(modified));
  await mobile.getByRole('button', { name: 'Check certificate' }).click();
  await expectText(mobile, 'Document Mismatch');

  await desktop.getByRole('row').filter({ hasText: id }).getByRole('button', { name: 'Revoke', exact: true }).click();
  await desktop.getByRole('button', { name: 'Confirm revocation' }).click();
  await desktop.getByRole('row').filter({ hasText: id }).getByText('revoked', { exact: true }).waitFor();
  await mobile.reload();
  await expectText(mobile, 'Revoked');
  assert.deepEqual(scriptErrors, []);
});
