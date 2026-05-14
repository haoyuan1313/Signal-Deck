// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AgentTradeRegistry
/// @notice On-chain registry for AI agent trade decisions — verifiable on Mantle Explorer.
///         Stores structured trade records with AI confidence scores.
///         Judges query: getDecision(0..N) for full agent trading history.
contract AgentTradeRegistry {
    struct TradeDecision {
        string symbol;       // e.g. "BTC/USDT"
        string action;       // "open" or "close"
        int256 entry;        // entry price × 1e8
        int256 stopLoss;     // SL price × 1e8
        int256 takeProfit;   // TP price × 1e8
        string direction;    // "long" or "short"
        uint256 aiConfidence; // basis points (0-10000), 0 = deterministic
        uint256 timestamp;
    }

    TradeDecision[] public decisions;
    address public agent;

    event DecisionLogged(
        uint256 indexed decisionId,
        address indexed by,
        string symbol,
        string action,
        string direction,
        uint256 aiConfidence,
        uint256 timestamp
    );

    constructor() {
        agent = msg.sender;
    }

    function logDecision(
        string calldata symbol,
        string calldata action,
        int256 entry,
        int256 stopLoss,
        int256 takeProfit,
        string calldata direction,
        uint256 aiConfidence
    ) external returns (uint256) {
        decisions.push();
        TradeDecision storage d = decisions[decisions.length - 1];
        d.symbol = symbol;
        d.action = action;
        d.entry = entry;
        d.stopLoss = stopLoss;
        d.takeProfit = takeProfit;
        d.direction = direction;
        d.aiConfidence = aiConfidence;
        d.timestamp = block.timestamp;
        uint256 id = decisions.length - 1;
        emit DecisionLogged(id, msg.sender, symbol, action, direction, aiConfidence, block.timestamp);
        return id;
    }

    function getDecisionCount() external view returns (uint256) {
        return decisions.length;
    }

    function getDecision(uint256 id) external view returns (TradeDecision memory) {
        require(id < decisions.length, "Invalid decision ID");
        return decisions[id];
    }

    function getDecisionsPaginated(uint256 offset, uint256 limit)
        external view
        returns (TradeDecision[] memory batch, uint256 total)
    {
        total = decisions.length;
        if (offset >= total) return (new TradeDecision[](0), total);
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 size = end - offset;
        batch = new TradeDecision[](size);
        for (uint256 i = 0; i < size; i++) {
            batch[i] = decisions[offset + i];
        }
    }
}
