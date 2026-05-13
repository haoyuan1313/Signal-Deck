import { create } from 'zustand';
import { supabase, type Trade, type Signal, type BotSettings, type BotLog } from '../lib/supabase';
import { SETTINGS_ID } from '../lib/constants';

interface SignalStore {
  trades: Trade[];
  signals: Signal[];
  logs: BotLog[];
  settings: BotSettings | null;
  botLive: boolean;
  lastHeartbeat: string | null;
  prices: Record<string, number>;
  loading: boolean;
  isAuthenticated: boolean;
  backendError: string | null;
  userId: string;
  authUsername: string | null;
  logoutFn: (() => Promise<void>) | null;
  fullHistoryLoaded: boolean;

  fetchInitialData: (silent?: boolean, userId?: string) => Promise<void>;
  fetchFullHistory:  () => Promise<void>;
  fetchLogs: () => Promise<void>;
  updatePrices: (symbol: string, price: number) => void;
  setPaused: (paused: boolean) => Promise<void>;
  addTrade: (trade: Trade) => void;
  updateTrade: (trade: Trade) => void;
  addSignal: (signal: Signal) => void;
  updateSettings: (settings: BotSettings) => Promise<void>;
  setAuthenticated: (status: boolean) => void;
}

export const useStore = create<SignalStore>((set, get) => ({
  trades: [],
  signals: [],
  logs: [],
  settings: null,
  botLive: false,
  lastHeartbeat: null,
  prices: {},
  loading: true,
  isAuthenticated: false,
  backendError: null,
  userId: 'demo-user',
  authUsername: null,
  logoutFn: null,
  fullHistoryLoaded: false,

  fetchInitialData: async (silent = false, userId = 'demo-user') => {
    if (!silent) set({ loading: true, userId });

    let timeoutId: any = null;
    if (!silent) {
      timeoutId = setTimeout(() => {
        if (get().loading) {
          console.warn('Store: Initial fetch timed out.');
          set({ loading: false, backendError: 'Initial data load timed out' });
        }
      }, 15000);
    }

    try {
      // ── Settings ─────────────────────────────────────────────────────────────
      // Try user-scoped settings first, then fall back to singleton id
      let settingsData: any = null;
      let settingsError: any = null;

      if (userId && userId !== 'demo-user') {
        const res = await supabase
          .from('bot_settings')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();
        settingsData  = res.data;
        settingsError = res.error;
      }

      // Fallback to singleton row
      if (!settingsData) {
        const res = await supabase
          .from('bot_settings')
          .select('*')
          .eq('id', SETTINGS_ID)
          .maybeSingle();
        settingsData  = res.data;
        settingsError = res.error;
      }

      if (settingsError) {
        console.error('Store: Error fetching settings:', settingsError.message);
      }

      let settings = settingsData || null;

      // Auto-init defaults if still nothing
      if (!settings && !settingsError) {
        const { data: initialized, error: initError } = await supabase
          .from('bot_settings')
          .insert({
            id:            SETTINGS_ID,
            symbols:       ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
            timeframe:     '5m',
            htf_timeframe: '1h',
            htf2_timeframe:'4h',
            rr:            2.0,
            bars:          500,
            paused:        false,
            paper_trading: true,
            risk_percent:  1.0,
          })
          .select()
          .maybeSingle();

        if (initError) {
          console.error('Store: Failed to init settings:', initError.message);
        } else {
          settings = initialized || null;
        }
      }

      // ── Trades / signals / logs / heartbeat ──────────────────────────────────
      const tradesQuery = userId && userId !== 'demo-user'
        ? supabase.from('trades').select('*').eq('user_id', userId).order('opened_at', { ascending: false }).limit(200)
        : supabase.from('trades').select('*').order('opened_at', { ascending: false }).limit(200);

      const [tradesRes, signalsRes, heartbeatRes, logsRes] = await Promise.all([
        tradesQuery,
        supabase.from('signals_log').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('bot_heartbeat').select('*').limit(1),
        supabase.from('bot_execution_logs').select('*').order('created_at', { ascending: false }).limit(50),
      ]);

      if (tradesRes.error)  console.warn('Store: Trades error:', tradesRes.error.message);
      if (signalsRes.error) console.warn('Store: Signals error:', signalsRes.error.message);

      const lastPing = heartbeatRes.data?.[0]?.last_ping;
      const botLive  = lastPing
        ? (Date.now() - new Date(lastPing).getTime()) < 2 * 60 * 1000
        : false;

      if (timeoutId) clearTimeout(timeoutId);

      set({
        trades:    tradesRes.data  || [],
        signals:   signalsRes.data || [],
        logs:      logsRes.data    || [],
        settings,
        botLive,
        lastHeartbeat: lastPing || null,
        loading: false,
        userId,
      });
    } catch (err) {
      console.error('Store: fetchInitialData error:', err);
      if (timeoutId) clearTimeout(timeoutId);
      set({ loading: false });
    }
  },

  fetchFullHistory: async () => {
    if (get().fullHistoryLoaded) return;
    try {
      const userId = get().userId;
      const query  = userId && userId !== 'demo-user'
        ? supabase.from('trades').select('*').eq('user_id', userId).eq('status', 'closed').order('opened_at', { ascending: false })
        : supabase.from('trades').select('*').eq('status', 'closed').order('opened_at', { ascending: false });

      const { data, error } = await query;
      if (error) { console.error('Store: fetchFullHistory error:', error.message); return; }

      const currentOpen = get().trades.filter(t => t.status === 'open');
      set({
        trades:            [...currentOpen, ...(data || [])],
        fullHistoryLoaded: true,
      });
    } catch (err) {
      console.error('Store: fetchFullHistory exception:', err);
    }
  },

  fetchLogs: async () => {
    try {
      const { data, error } = await supabase
        .from('bot_execution_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error && data) set({ logs: data });
    } catch {}
  },

  updatePrices: (symbol, price) => {
    set(state => ({ prices: { ...state.prices, [symbol]: price } }));
  },

  setPaused: async (paused: boolean) => {
    const settings = get().settings;
    if (!settings) return;
    const { error } = await supabase
      .from('bot_settings')
      .update({ paused, updated_at: new Date().toISOString() })
      .eq('id', settings.id);
    if (error) throw new Error(`Failed to update master switch: ${error.message}`);
    set({ settings: { ...settings, paused } });
  },

  addTrade: trade => set(state => ({
    trades: [trade, ...state.trades.filter(t => t.id !== trade.id)],
  })),

  updateTrade: trade => set(state => ({
    trades: state.trades.map(t => t.id === trade.id ? trade : t),
  })),

  addSignal: signal => set(state => ({
    signals: [signal, ...state.signals.slice(0, 49)],
  })),

  updateSettings: async (newSettings: BotSettings) => {
    const { id, ...updateData } = newSettings;
    const { error } = await supabase
      .from('bot_settings')
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    set({ settings: newSettings });
  },

  setAuthenticated: status => set({ isAuthenticated: status }),
}));