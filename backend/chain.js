import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Contract, FetchRequest, JsonRpcProvider, Wallet, id, getAddress, ZeroAddress } from 'ethers';

const chainId = Number(process.env.CHAIN_ID || 31337);
const deployment = JSON.parse(readFileSync(new URL(`../contracts/deployments/${chainId}.json`, import.meta.url)));
const { abi } = JSON.parse(readFileSync(new URL('../contracts/artifacts/contracts/CertificateRegistry.sol/CertificateRegistry.json', import.meta.url)));
const rpc = new FetchRequest(process.env.RPC_URL || 'http://127.0.0.1:8545');
rpc.timeout = 5000;
const provider = new JsonRpcProvider(rpc, chainId, { cacheTimeout: -1 });
const confirmations = Number(process.env.CONFIRMATIONS || (chainId === 31337 ? 1 : 2));
if (![31337,11155111].includes(chainId) || deployment.chainId !== chainId ||
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
export async function registrationHash(id, from, to) {
  for (let block = from; block <= to; block += 2000) {
    const logs = await registry.queryFilter(registry.filters.Registered(keyFor(id)), block, Math.min(to, block + 1999));
    if (logs.length) return logs[0].transactionHash;
  }
  throw new Error('Registration event unavailable.');
}
