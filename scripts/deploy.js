const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying AgentTradeRegistry...");
  console.log("Deployer:", deployer.address);

  const factory = await hre.ethers.getContractFactory("AgentTradeRegistry");
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("AgentTradeRegistry deployed to:", address);
  console.log("");
  console.log("Add this to .env or Fly secrets:");
  console.log(`AGENT_TRADE_REGISTRY_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
