import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useStore } from '../store/useStore';

export function useRealtime(userId?: string | null) {
  const { addTrade, updateTrade, addSignal, fetchInitialData, settings } = useStore();

  useEffect(() => {
    // Only fetch if we know the user ID (can be 'demo-user')
    if (userId === undefined) return;

    fetchInitialData(false, userId || 'demo-user');

    const tradeSub = supabase
      .channel('trades-channel')
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'trades' }, (payload: any) => {
        if (payload.eventType === 'INSERT') addTrade(payload.new as any);
        else if (payload.eventType === 'UPDATE') updateTrade(payload.new as any);
      })
      .subscribe();

    const signalSub = supabase
      .channel('signals-channel')
      .on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: 'signals_log' }, (payload: any) => {
        addSignal(payload.new as any);
      })
      .subscribe();

    const heartbeatSub = supabase
      .channel('heartbeat-channel')
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'bot_heartbeat' }, () => {
        useStore.setState({ botLive: true });
      })
      .subscribe();

    return () => {
      tradeSub.unsubscribe();
      signalSub.unsubscribe();
      heartbeatSub.unsubscribe();
    };
  }, []);

  // ── Price polling ────────────────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const poll = async (retryCount = 0) => {
      if (!isMounted) return;
      if (retryTimeout) clearTimeout(retryTimeout);

      try {
        const defaultSymbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT'];
        const state          = useStore.getState();

        // Collect all symbols that need a live price.
        const activeTradeSymbols = state.trades
          .filter(t => t.status === 'open')
          .map(t => t.symbol);

        const settingsSymbols = settings?.symbols || [];

        const allSymbols = Array.from(
          new Set([...defaultSymbols, ...activeTradeSymbols, ...settingsSymbols])
        );

        if (!allSymbols.length) return;

        const encodedSymbols = encodeURIComponent(allSymbols.join(','));
        const res            = await fetch(`/api/prices?symbols=${encodedSymbols}`);

        if (!isMounted) return;

        const contentType = res.headers.get('content-type');
        const isHtml      = contentType?.includes('text/html');

        if (!res.ok || isHtml) {
          if (isHtml || res.status >= 502 || res.status === 503) {
            // During startup, we might get the "Starting Server" HTML or 503 Service Unavailable.
            // Be very patient during initial retries (up to 15 attempts).
            if (retryCount < 15) {
              const delay = 2000 * Math.min(retryCount + 1, 5);
              retryTimeout = setTimeout(() => poll(retryCount + 1), delay);
              return;
            }
          }
          const body = await res.text().catch(() => '');
          if (isHtml && (body.includes('application starts') || body.includes('Starting Server'))) {
             // Silently fail this poll iteration if still starting.
             return;
          }
          let errorData: any;
          try { errorData = JSON.parse(body); } catch { errorData = { error: body.slice(0, 100) || `HTTP ${res.status}` }; }
          throw new Error(errorData.details || errorData.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        if (!isMounted) return;
        if (data.error) throw new Error(data.details || data.error);

        // ... rest of processing ...
        const normalised: Record<string, number> = {};
        for (const [key, price] of Object.entries(data as Record<string, number>)) {
          if (typeof price !== 'number' || isNaN(price) || price <= 0) continue;
          normalised[key] = price;
          if (key.includes(':')) {
            const baseKey = key.split(':')[0];
            normalised[baseKey] = price;
          }
          if (!key.includes(':') && key.includes('/')) {
            const quote   = key.split('/')[1];
            const swapKey = `${key}:${quote}`;
            normalised[swapKey] = price;
          }
        }

        useStore.setState(s => ({
          backendError: null,
          prices: { ...s.prices, ...normalised },
        }));
      } catch (err) {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : String(err);
        
        // If it's a network error or startup HTML, retry up to a point
        if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('load failed')) {
          if (retryCount < 15) {
            const delay = 3000 * Math.min(retryCount + 1, 5);
            retryTimeout = setTimeout(() => poll(retryCount + 1), delay);
            return;
          }
        }

        // Only show error in UI if we've really given up or it's a genuine non-network error
        if (retryCount >= 3) {
          console.error('Price fetch error:', msg);
          useStore.setState({ backendError: msg });
        }
      }
    };

    pollInterval = setInterval(() => poll(0), 10000);
    poll(0);

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [settings?.symbols]);
}