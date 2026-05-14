import { createClient } from '@supabase/supabase-js';

const rawUrl = (import.meta as any).env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

// Sanitize URL
const supabaseUrl = rawUrl.trim().replace(/\/+$/, "").replace("/rest/v1", "");

export const isSupabaseConfigured = !!supabaseUrl && !supabaseUrl.includes("placeholder") && !!supabaseAnonKey;

if (!isSupabaseConfigured) {
  console.warn('Supabase credentials missing. App will run in demo/mock mode.');
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder'
);

export async function testSupabaseConnection() {
  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("placeholder")) {
     return { success: false, error: "Settings missing (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)" };
  }
  try {
    // Test multiple tables to pinpoint which one is missing
    const tables = ['bot_settings', 'bot_execution_logs', 'trades', 'signals_log'];
    const results: Record<string, boolean> = {};
    
    for (const table of tables) {
      const { error } = await supabase.from(table).select('id').limit(1);
      results[table] = !error;
      if (error) {
        console.warn(`Supabase Test: Table '${table}' missing or inaccessible:`, error.message);
      }
    }

    const missing = Object.entries(results).filter(([_, exists]) => !exists).map(([name]) => name);
    
    if (missing.length > 0) {
      return { 
        success: false, 
        error: `Missing tables: ${missing.join(', ')}. Please run the SQL script in Supabase Dashboard.`,
        details: results
      };
    }

    return { success: true, results };
  } catch (err: any) {
    return { success: false, error: err.message || "Unknown error" };
  }
}

// Types
export type Trade = {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  entry: number;
  sl_init: number;
  sl: number;
  tp: number;
  rr: number;
  risk: number;
  bars_held: number;
  be_armed: boolean;
  status: 'open' | 'closed';
  is_paper: boolean;
  exchange_type?: string;
  order_id?: string;
  outcome: 1 | 0 | -1 | null;
  r: number | null;
  exit_price: number | null;
  opened_at: string;
  closed_at: string | null;
  mantle_tx_hash?: string | null;
  is_on_chain?: boolean;
  mantle_block?: number | null;
  mantle_logged_at?: string | null;
  ai_confidence?: number;
  ai_reasoning?: string;
};

export type Signal = {
  id: string;
  symbol: string;
  direction: string;
  reason: string;
  price: number;
  htf_trend: string;
  htf2_regime: string;
  created_at: string;
  metadata?: Record<string, any>;
};

export type BotSettings = {
  id: string;
  symbols: string[];
  timeframe: string;
  htf_timeframe: string;
  htf2_timeframe: string;
  rr: number;
  bars: number;
  risk_percent: number;
  allowed_directions: string[];
  paused: boolean;
  paper_trading: boolean;
  atr_period: number;
  allowed_sessions: string[];
  require_4h_align: boolean;
  updated_at: string;
};

export type BotLog = {
  id: string;
  message: string;
  type: 'info' | 'loop' | 'check' | 'reject' | 'accept';
  created_at: string;
};
