import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Contract, FetchRequest, JsonRpcProvider, Wallet, id, getAddress, ZeroAddress } from 'ethers';

const managedSepolia = process.env.AUTO_DEPLOY_SEPOLIA === 'true';
const chainId = Number(process.env.CHAIN_ID || (managedSepolia ? 11155111 : 31337));
let deployment;
if (process.env.REGISTRY_DEPLOYMENT_JSON) {
  deployment = JSON.parse(process.env.REGISTRY_DEPLOYMENT_JSON);
} else if (managedSepolia) {
  const { db } = await import('./db.js');
  const result = await db.query('SELECT metadata FROM network_deployments WHERE chain_id=$1', [chainId]);
  deployment = result.rows[0]?.metadata;
  if (!deployment) throw new Error('Run the Railway registry deployment before starting the service.');
} else {
  deployment = JSON.parse(readFileSync(new URL(`../contracts/deployments/${chainId}.json`, import.meta.url), 'utf8'));
}
const { abi } = JSON.parse(readFileSync(new URL('../contracts/artifacts/contracts/CertificateRegistry.sol/CertificateRegistry.json', import.meta.url)));
const rpc = new FetchRequest(process.env.RPC_URL || 'http://127.0.0.1:8545');
rpc.timeout = 5000;
const provider = new JsonRpcProvider(rpc, chainId, { cacheTimeout: -1 });
const confirmations = Number(process.env.CONFIRMATIONS || (chainId === 31337 ? 1 : 2));
if (![31337,11155111].includes(chainId) || deployment.chainId !== chainId ||
    !/^0x[0-9a-fA-F]{40}$/.test(deployment.address) ||
    !Number.isSafeInteger(deployment.block) || deployment.block < 1 ||
    !/^0x[0-9a-fA-F]{64}$/.test(deployment.transaction) ||
    !/^0x[0-9a-fA-F]{64}$/.test(deployment.deploymentId) ||
    !Number.isInteger(confirmations) || confirmations < 1) throw new Error('Invalid blockchain configuration.');

const registry = new Contract(deployment.address, abi, provider);
const local = chainId === 31337 && process.env.LOCAL_UNLOCKED_SIGNERS === 'true';
const keys = [process.env.ADMIN_PRIVATE_KEY, ...(process.env.ISSUER_PRIVATE_KEYS || '').split(',')]
  .map(key => key?.trim()).filter(Boolean);
const wallets = new Map(keys.map(key => {
  const wallet = new Wallet(key, provider);
  return [wallet.address.toLowerCase(), wallet];
}));

export const keyFor = id;
export const registryKey = `${chainId}:${deployment.address.toLowerCase()}:${deployment.transaction}`;
export const networkInfo = { chainId, address: deployment.address, confirmations };
export { getAddress, ZeroAddress };

export class ChainError extends Error {
  constructor(cause) { super('Blockchain temporarily unavailable or transaction incomplete.', { cause }); }
}

export async function onChain(fn) {
  try { return await fn(); } catch (error) { throw new ChainError(error); }
}

export async function confirmedBlock() {
  const height = await provider.getBlockNumber();
  const block = height - confirmations + 1;
  if (block < deployment.block || await registry.deploymentId({ blockTag: block }) !== deployment.deploymentId) {
    throw new Error('Registry deployment is not confirmed or RPC is on a different chain.');
  }
  return block;
}

async function signer(address) {
  if (local) return provider.getSigner(address);
  const wallet = wallets.get(address.toLowerCase());
  if (!wallet) throw new Error('No configured signer for this wallet.');
  return wallet;
}

export async function admin() { return registry.administrator(); }
export async function localAccounts() {
  if (!local) return [];
  return (await provider.listAccounts()).slice(1).map(account => account.address);
}
export async function supportedIssuer(address) {
  return local ? (await localAccounts()).some(a => a.toLowerCase() === address) : wallets.has(address);
}
export async function record(id, blockTag) { return registry.certificates(keyFor(id), { blockTag }); }
export async function approved(address, blockTag) { return registry.approved(address, { blockTag }); }
export async function issue(address, id, digest) {
  return registry.connect(await signer(address)).register(keyFor(id), digest);
}
export async function setApproval(address, enabled) {
  return registry.connect(await signer(await admin())).setIssuer(address, enabled);
}
export async function revoke(address, id) {
  return registry.connect(await signer(address || await admin())).revoke(keyFor(id));
}
export async function wait(tx) {
  const receipt = await tx.wait(confirmations, chainId === 31337 ? 12000 : 45000);
  if (receipt?.status !== 1) throw new Error('Transaction did not confirm successfully.');
  return receipt;
}
export async function receipt(hash) { return provider.getTransactionReceipt(hash); }
export async function registrationHash(id, from, to, knownHash, issuer, digest) {
  if (knownHash) {
    const mined = await receipt(knownHash);
    if (mined?.status === 1 && mined.blockNumber >= from && mined.blockNumber <= to) {
      const event = registry.interface.getEvent('Registered');
      const matches = mined.logs.some(log => {
        if (log.address.toLowerCase() !== registry.target.toLowerCase() ||
            log.topics[0] !== event.topicHash || log.topics[1] !== keyFor(id)) return false;
        const args = registry.interface.decodeEventLog(event, log.data, log.topics);
        return args[1].toLowerCase() === issuer && args[2] === digest;
      });
      if (matches) return mined.hash;
    }
  }
  for (let block = from; block <= to; block += 2000) {
    const logs = await registry.queryFilter(registry.filters.Registered(keyFor(id)), block, Math.min(to, block + 1999));
    if (logs.length) return logs[0].transactionHash;
  }
  throw new Error('Registration event unavailable.');
}
