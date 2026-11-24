const { mkdirSync, writeFileSync } = require('node:fs');
const { ethers } = require('hardhat');

async function deploy() {
  const network = await ethers.provider.getNetwork();
  const registry = await ethers.deployContract('CertificateRegistry');
  const receipt = await registry.deploymentTransaction().wait(network.chainId === 11155111n ? 2 : 1);
  const config = { address: await registry.getAddress(), chainId: Number(network.chainId),
    block: receipt.blockNumber, transaction: receipt.hash };
  mkdirSync('deployments', { recursive: true });
  writeFileSync(`deployments/${config.chainId}.json`, JSON.stringify(config, null, 2));
  console.log(config);
}

deploy().catch(error => { console.error(error); process.exitCode = 1; });
