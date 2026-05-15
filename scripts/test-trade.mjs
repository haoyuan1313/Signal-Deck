// End-to-end test: AI scoring → Mantle contract write → verify on explorer
// Usage: node scripts/test-trade.mjs [--mainnet]
//   Defaults to testnet. Pass --mainnet to target Mantle mainnet.
import { ethers } from 'ethers';
import readline from 'readline';

const PK = process.env.MANTLE_PRIVATE_KEY;
if (!PK) { console.error('MANTLE_PRIVATE_KEY must be set'); process.exit(1); }

const args = process.argv.slice(2);
const requestedMainnet = args.includes('--mainnet');
const isMainnet = requestedMainnet && process.env.MANTLE_MAINNET === 'true';

const CHAIN_ID = isMainnet ? 5000 : 5001;
const RPC = isMainnet
  ? 'https://rpc.mantle.xyz'
  : 'https://rpc.sepolia.mantle.xyz';
const EXPLORER = isMainnet
  ? 'https://explorer.mantle.xyz'
  : 'https://explorer.sepolia.mantle.xyz';
const NETWORK_NAME = isMainnet ? 'MANTLE MAINNET' : 'Mantle Sepolia Testnet';

const CONTRACT = process.env.AGENT_TRADE_REGISTRY_ADDRESS;
if (!CONTRACT) { console.error('AGENT_TRADE_REGISTRY_ADDRESS must be set'); process.exit(1); }

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);

const abi = [
  'function logDecision(string,string,int256,int256,int256,string,uint256) external returns (uint256)',
  'function getDecisionCount() external view returns (uint256)',
  'function decisions(uint256) external view returns (tuple(string,string,int256,int256,int256,string,uint256,uint256))',
  'event DecisionLogged(uint256 indexed, address indexed, string, string, string, uint256, uint256)'
];

async function main() {
  console.log('=== SignalDeck End-to-End Trade Test ===\n');
  console.log('Network:', NETWORK_NAME, `(chain ${CHAIN_ID})`);
  console.log('Wallet:', wallet.address);
  console.log('Contract:', CONTRACT);
  console.log('Balance:', ethers.formatEther(await provider.getBalance(wallet.address)), 'MNT\n');

  const contract = new ethers.Contract(CONTRACT, abi, wallet);
  const countBefore = await contract.getDecisionCount();
  console.log('Decisions on-chain before test:', Number(countBefore));

  // Step 1: AI scoring via Claude
  let aiConfidence = 0;
  let aiReasoning = 'no AI scoring';
  if (ANTHROPIC_KEY) {
    console.log('\n--- AI Scoring ---');
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 256,
          temperature: 0.2,
          messages: [{ role: 'user', content: `Score this SMC trade setup 0-10000:\nSymbol: BTC/USDT\nDirection: short\nEntry: 87250.00\nSL: 87650.00\nTP: 86050.00\nHTF Trend: bearish\nSession: london\n\nReturn only JSON: {"confidence": <0-10000>, "reasoning": "<one sentence>"}` }],
        }),
      });
      const data = await resp.json();
      const text = data.content?.map(b => b.text || '').join('') || '';
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      aiConfidence = Math.max(0, Math.min(10000, parseInt(String(parsed.confidence)) || 0));
      aiReasoning = parsed.reasoning || '';
      console.log('AI Confidence:', aiConfidence, '/ 10000');
      console.log('AI Reasoning:', aiReasoning);
    } catch (e) {
      console.log('AI scoring failed (non-blocking):', e.message);
      aiReasoning = 'AI scoring unavailable — deterministic fallback';
    }
  } else {
    console.log('No ANTHROPIC_API_KEY — skipping AI scoring');
  }

  // Mainnet confirmation gate
  if (isMainnet) {
    console.log('\n⚠️  ⚠️  ⚠️  MAINNET CONFIRMATION REQUIRED ⚠️  ⚠️  ⚠️');
    console.log(`Chain:      ${NETWORK_NAME} (${CHAIN_ID})`);
    console.log(`Contract:   ${CONTRACT}`);
    console.log(`Wallet:     ${wallet.address}`);
    console.log('This will write a PERMANENT, IMMUTABLE test record on-chain.');
    console.log('It CANNOT be deleted and WILL appear on Mantle Explorer.\n');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>(resolve => {
      rl.question('Type the contract address to confirm: ', a => { rl.close(); resolve(a); });
    });
    if (answer !== CONTRACT) {
      console.log('Confirmation failed — aborting.');
      process.exit(1);
    }
    console.log('Confirmed. Proceeding with mainnet write...\n');
  }

  // Step 2: Log decision to Mantle contract
  console.log('\n--- On-Chain Log ---');
  const symbol = 'BTC/USDT';
  const action = 'open';
  const entry = 8725000; // 87250.00 * 1e8
  const sl = 8765000;
  const tp = 8605000;
  const direction = 'short';

  console.log(`Trade: ${action} ${symbol} ${direction} @ $${(entry/1e8).toFixed(2)}`);
  console.log(`SL: $${(sl/1e8).toFixed(2)} TP: $${(tp/1e8).toFixed(2)}`);
  console.log(`aiConfidence: ${aiConfidence}`);

  const tx = await contract.logDecision(symbol, action, entry, sl, tp, direction, aiConfidence, { gasLimit: 300000n });
  console.log('Tx submitted:', tx.hash);
  const receipt = await tx.wait();
  console.log('Tx confirmed in block:', receipt.blockNumber);

  // Step 3: Verify on-chain
  const countAfter = await contract.getDecisionCount();
  console.log('\n--- Verification ---');
  console.log('Decisions on-chain:', Number(countAfter), `(was ${Number(countBefore)})`);

  if (countAfter > countBefore) {
    const decision = await contract.decisions(Number(countAfter) - 1);
    console.log('Latest decision:');
    console.log('  Symbol:', decision[0]);
    console.log('  Action:', decision[1]);
    console.log('  Entry:', Number(decision[2]) / 1e8);
    console.log('  SL:', Number(decision[3]) / 1e8);
    console.log('  TP:', Number(decision[4]) / 1e8);
    console.log('  Direction:', decision[5]);
    console.log('  AI Confidence:', Number(decision[6]));
    console.log('  Timestamp:', new Date(Number(decision[7]) * 1000).toISOString());
  }

  console.log('\nExplorer:', `${EXPLORER}/tx/${receipt.hash}`);
  console.log('Contract:', `${EXPLORER}/address/${CONTRACT}`);
  console.log('✅ End-to-end test complete');
}

main().catch(e => { console.error('Test failed:', e); process.exit(1); });
