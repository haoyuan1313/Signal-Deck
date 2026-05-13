// aiAdminService handles high-level data management
// Now uses Claude (Anthropic) via /api/ai-admin — no Gemini key needed.

export interface CleanupResult {
  trashIds: string[];
  reasoning: string;
}

export const aiAdminService = {
  async detectTrashTrades(trades: any[]): Promise<CleanupResult> {
    if (trades.length === 0) return { trashIds: [], reasoning: "No trades provided for analysis." };

    try {
      const prompt = `
        You are a trading database auditor. Identify logically impossible "glitch" entries in the trade history:
        - Trades held for 0 minutes (bars_held: 0) but showing non-zero R (Profit/Loss).
        - Trades with extreme/impossible R values (e.g. > 100R).
        - Logically impossible outcomes.
        - Trades with bars_held > 200 but R is 0.

        Trades Data (JSON): ${JSON.stringify(trades.map(t => ({ id: t.id, r: t.r, bars: t.bars_held })).slice(0, 100))}

        Output ONLY valid JSON — no markdown fences, no explanation outside the JSON:
        {
          "trashIds": ["uuid-1", "uuid-2"],
          "reasoning": "Brief explanation of found glitches"
        }
      `;

      const response = await fetch("/api/ai-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });

      const responseData = await response.json();
      
      if (!response.ok) {
        throw new Error(responseData.error || `Server responded with status ${response.status}`);
      }

      const text = responseData.text || "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : "{}";
      const output = JSON.parse(jsonStr);
      
      return {
        trashIds: Array.isArray(output.trashIds) ? output.trashIds : [],
        reasoning: output.reasoning || "Audit completed successfully."
      };
    } catch (err: any) {
      console.error("AI Admin Error:", err);
      return { trashIds: [], reasoning: `AI Audit failed: ${err.message || 'Unknown error'}` };
    }
  },

  async bulkDelete(ids: string[], table: string = 'trades'): Promise<{ success: boolean; error?: string }> {
    if (ids.length === 0) return { success: false, error: "No trade IDs provided." };
    
    try {
      console.log(`AI Admin: Forwarding bulk delete to server for ${ids.length} entries in ${table}...`);
      const response = await fetch("/api/admin/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, table })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Server bulk delete failed");
      }

      return { success: true };
    } catch (err: any) {
      console.error("Bulk Delete Proxy Error:", err);
      return { success: false, error: err.message };
    }
  }
};