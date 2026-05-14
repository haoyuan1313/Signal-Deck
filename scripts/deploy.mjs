import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const PK = process.env.MANTLE_PRIVATE_KEY || '0xdde208c80f562834c9ed3db7057f84d2fd1fd9ec6f3505c283f3016e8caedfba';
const RPC = 'https://rpc.mantle.xyz';

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);

console.log('Deployer:', wallet.address);
console.log('Balance:', ethers.formatEther(await provider.getBalance(wallet.address)), 'MNT');

// Compiled bytecode and ABI from solc output
// We compile inline since solc package has ESM issues
const abi = [
  "constructor()",
  "function logDecision(string,string,int256,int256,int256,string,uint256) external returns (uint256)",
  "function getDecisionCount() external view returns (uint256)",
  "function getDecision(uint256) external view returns (tuple(string,string,int256,int256,int256,string,uint256,uint256))",
  "function getDecisionsPaginated(uint256,uint256) external view returns (tuple(string,string,int256,int256,int256,string,uint256,uint256)[], uint256)",
  "function decisions(uint256) external view returns (string,string,int256,int256,int256,string,uint256,uint256)",
  "function agent() external view returns (address)",
  "event DecisionLogged(uint256 indexed, address indexed, string, string, string, uint256, uint256)"
];

const bytecode = readFileSync('contracts/AgentTradeRegistry.bin', 'utf8').trim();
console.log('Bytecode length:', bytecode.length, 'chars');

async function deploy() {
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  console.log('Deploying AgentTradeRegistry to Mantle mainnet...');
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log('');
  console.log('DEPLOYED:', addr);
  console.log('Explorer:', 'https://explorer.mantle.xyz/address/' + addr);
  console.log('');
  console.log('Set this in Fly secrets:');
  console.log('fly secrets set AGENT_TRADE_REGISTRY_ADDRESS=' + addr);
}

deploy().catch(err => {
  console.error('Deploy failed:', err);
  process.exit(1);
});
