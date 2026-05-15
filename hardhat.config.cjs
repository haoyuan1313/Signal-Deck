require("@nomicfoundation/hardhat-toolbox");

const PK = process.env.MANTLE_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000";

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: "0.8.20",
  networks: {
    "mantle-testnet": {
      url: "https://rpc.sepolia.mantle.xyz",
      chainId: 5001,
      accounts: [PK],
    },
    mantle: {
      url: "https://rpc.mantle.xyz",
      chainId: 5000,
      accounts: [PK],
    },
  },
  etherscan: {
    apiKey: {
      "mantle-testnet": "no-api-key-needed",
      mantle: "no-api-key-needed",
    },
    customChains: [
      {
        network: "mantle-testnet",
        chainId: 5001,
        urls: {
          apiURL: "https://explorer.sepolia.mantle.xyz/api",
          browserURL: "https://explorer.sepolia.mantle.xyz",
        },
      },
      {
        network: "mantle",
        chainId: 5000,
        urls: {
          apiURL: "https://explorer.mantle.xyz/api",
          browserURL: "https://explorer.mantle.xyz",
        },
      },
    ],
  },
};
