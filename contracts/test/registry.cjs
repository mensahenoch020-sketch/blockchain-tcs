const assert = require('node:assert/strict');
const { ethers } = require('hardhat');

describe('CertificateRegistry', function () {
  const id = ethers.id('TCS-DEMO');
  const digest = ethers.sha256(ethers.toUtf8Bytes('sample PDF bytes'));
  let admin, issuer, stranger, registry;
  beforeEach(async function () {
    [admin, issuer, stranger] = await ethers.getSigners();
    registry = await ethers.deployContract('CertificateRegistry', [ethers.id('test-deployment')]);
  });

  it('registers and retrieves a timestamped record for an approved issuer', async function () {
    await registry.setIssuer(issuer, true);
    const receipt = await (await registry.connect(issuer).register(id, digest)).wait();
    const row = await registry.certificates(id);
    assert.equal(row.digest, digest);
    assert.equal(row.issuer, issuer.address);
    assert.equal(row.revoked, false);
    assert.equal(row.issuedAt, BigInt((await ethers.provider.getBlock(receipt.blockNumber)).timestamp));
    assert.equal(registry.interface.parseLog(receipt.logs[0]).name, 'Registered');
  });

  it('rejects unauthorized and disabled issuers', async function () {
    await assert.rejects(registry.connect(issuer).register(id, digest), /Forbidden/);
    await registry.setIssuer(issuer, true);
    await registry.setIssuer(issuer, false);
    await assert.rejects(registry.connect(issuer).register(id, digest), /Forbidden/);
  });

  it('rejects duplicates across approved issuers', async function () {
    await registry.setIssuer(issuer, true);
    await registry.setIssuer(stranger, true);
    await registry.connect(issuer).register(id, digest);
    await assert.rejects(registry.connect(stranger).register(id, digest), /Duplicate/);
  });

  it('restricts approvals and revocation to authorized accounts', async function () {
    await assert.rejects(registry.connect(stranger).setIssuer(stranger, true), /Forbidden/);
    await registry.setIssuer(issuer, true);
    await registry.connect(issuer).register(id, digest);
    await assert.rejects(registry.connect(stranger).revoke(id), /Forbidden/);
    await registry.setIssuer(issuer, false);
    await assert.rejects(registry.connect(issuer).revoke(id), /Forbidden/);
    await registry.connect(admin).revoke(id);
    assert.equal((await registry.certificates(id)).revoked, true);
  });

  it('allows the active original issuer to revoke once', async function () {
    await registry.setIssuer(issuer, true);
    await registry.connect(issuer).register(id, digest);
    const receipt = await (await registry.connect(issuer).revoke(id)).wait();
    assert.equal(registry.interface.parseLog(receipt.logs[0]).name, 'Revoked');
    await assert.rejects(registry.revoke(id), /InvalidRecord/);
    assert.equal((await registry.certificates(ethers.id('missing'))).issuer, ethers.ZeroAddress);
  });
});
