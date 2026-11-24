import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { FetchRequest, JsonRpcProvider, Wallet, isError } from 'ethers';
import { db } from './db.js';

const automatic = process.env.AUTO_DEPLOY_SEPOLIA === 'true' && !process.env.REGISTRY_DEPLOYMENT_JSON;
let provider;
try {
  if (automatic) {
    const missing = ['DATABASE_URL', 'RPC_URL', 'ADMIN_PRIVATE_KEY'].filter(name => !process.env[name]);
    if (missing.length) throw new Error('Missing Railway variables: ' + missing.join(', '));
    if (process.env.CHAIN_ID && process.env.CHAIN_ID !== '11155111') {
      throw new Error('Set CHAIN_ID=11155111 to enable automatic Sepolia deployment.');
    }
  }
  execFileSync(process.execPath, ['backend/setup.js'], { stdio: 'inherit' });
  if (automatic) {
    const rpc = new FetchRequest(process.env.RPC_URL);
    rpc.timeout = 10_000;
    provider = new JsonRpcProvider(rpc);
    const wallet = new Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
    const { deployRegistry } = await import('./deploy-registry.js');
    const registry = await deployRegistry(provider, wallet, 11155111);
    console.log('Sepolia registry ready:', registry.address, registry.transaction);
  }
} catch (error) {
  // Ethers error details can contain credentials or the signed transaction.
  if (error.message?.startsWith('Missing Railway variables:') || error.message?.startsWith('Set CHAIN_ID=')) {
    console.error(error.message);
  } else if (isError(error, 'INSUFFICIENT_FUNDS')) {
    console.error('Registry deployment failed: fund the administrator wallet with Sepolia test ETH.');
  } else {
    console.error('Railway preparation failed. Check the Sepolia RPC, administrator wallet and database. Code:',
      error.code || error.name);
  }
  process.exitCode = 1;
} finally {
  provider?.destroy();
  await db.end();
}
