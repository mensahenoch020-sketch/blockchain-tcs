require('dotenv').config({ path: '../.env' });
require('@nomicfoundation/hardhat-ethers');
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, _, runSuper) => {
  if (solcVersion !== '0.8.28') return runSuper();
  return { compilerPath: require.resolve('solc/soljson.js'), isSolcJs: true,
    version: solcVersion, longVersion: require('solc').version() };
});

module.exports = {
  solidity: '0.8.28',
  networks: {
    localhost: { url: 'http://127.0.0.1:8545', chainId: 31337 },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || 'http://127.0.0.1:8545',
      chainId: 11155111,
      accounts: process.env.ADMIN_PRIVATE_KEY ? [process.env.ADMIN_PRIVATE_KEY] : []
    }
  }
};
