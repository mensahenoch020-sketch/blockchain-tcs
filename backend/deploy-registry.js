import { readFileSync } from 'node:fs';
import { ContractFactory, Transaction, getCreateAddress, hexlify, randomBytes } from 'ethers';
import { db } from './db.js';

export const registryArtifact = JSON.parse(readFileSync(
  new URL('../contracts/artifacts/contracts/CertificateRegistry.sol/CertificateRegistry.json', import.meta.url), 'utf8'
));

export async function deployRegistry(provider, wallet, chainId) {
  if ((await provider.getNetwork()).chainId !== BigInt(chainId)) throw new Error('RPC chain ID mismatch.');
  const client = await db.connect();
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(388276) AS acquired');
    if (!lock.rows[0].acquired) throw new Error('Another registry deployment is in progress. Retry shortly.');
    const stored = await client.query('SELECT * FROM network_deployments WHERE chain_id=$1', [chainId]);
    let row = stored.rows[0];
    if (!row) {
      const deploymentId = hexlify(randomBytes(32));
      const factory = new ContractFactory(registryArtifact.abi, registryArtifact.bytecode, wallet);
      const request = await wallet.populateTransaction(await factory.getDeployTransaction(deploymentId));
      const signed = await wallet.signTransaction(request);
      const inserted = await client.query(
        `INSERT INTO network_deployments(chain_id,administrator,deployment_id,signed_transaction)
         VALUES($1,$2,$3,$4) RETURNING *`, [chainId, wallet.address, deploymentId, signed]);
      row = inserted.rows[0];
    }
    if (row.administrator !== wallet.address) throw new Error('The deployment belongs to a different administrator wallet.');
    if (row.metadata) return row.metadata;
    const transaction = Transaction.from(row.signed_transaction);
    let receipt = await provider.getTransactionReceipt(transaction.hash);
    if (!receipt && !await provider.getTransaction(transaction.hash)) {
      try {
        await provider.broadcastTransaction(row.signed_transaction);
      } catch (error) {
        if (!await provider.getTransaction(transaction.hash) && !await provider.getTransactionReceipt(transaction.hash)) {
          throw error;
        }
      }
    }
    receipt = receipt && await receipt.confirmations() >= 2 ? receipt :
      await provider.waitForTransaction(transaction.hash, 2, 110_000);
    const address = getCreateAddress({ from: wallet.address, nonce: transaction.nonce });
    if (!receipt || receipt.status !== 1 || receipt.contractAddress !== address) {
      throw new Error('Registry deployment did not confirm successfully.');
    }
    const metadata = { chainId, address, transaction: transaction.hash,
      block: receipt.blockNumber, deploymentId: row.deployment_id };
    await client.query('UPDATE network_deployments SET metadata=$2 WHERE chain_id=$1', [chainId, metadata]);
    return metadata;
  } finally {
    // Close this session so PostgreSQL releases the advisory lock even on failure.
    client.release(true);
  }
}
