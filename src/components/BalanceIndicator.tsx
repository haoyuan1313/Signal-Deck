import { useEffect, useState } from 'react';
import { Wallet, Unplug } from 'lucide-react';
import { cn } from '../lib/utils';
import { useUser } from '../hooks/useUser';

interface Balance {
  equity: number;
  isTestnet: boolean;
  accountType: string;
}

interface BalanceIndicatorProps {
  size?: 'sm' | 'md' | 'lg';
  hideLabel?: boolean;
}

export default function BalanceIndicator({
  size = 'md',
  hideLabel = false,
}: BalanceIndicatorProps) {
  const { userId } = useUser();
  const [balance,     setBalance]     = useState<Balance | null>(null);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [retryCount,  setRetryCount]  = useState(0);

  useEffect(() => {
    let isMounted = true;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    if (!userId) return;

    const fetchBalance = async () => {
      try {
        const res = await fetch('/api/balance', {
          cache: 'no-store',
          headers: { 
            Accept: 'application/json',
            'x-user-id': userId
          },
        });

        if (!isMounted) return;

        if (!res.ok) {
          let msg = 'Sync Error';
          try {
            const d = await res.json();
            msg = d.error || msg;
          } catch {
            msg = `Server ${res.status}`;
          }
          setErrorStatus(msg);
          return;
        }

        const data = await res.json();
        if (isMounted) {
          setBalance(data);
          setErrorStatus(null);
          setRetryCount(0);
        }
      } catch (err: any) {
        if (!isMounted) return;
        const msg = err.message || String(err);
        const isNetworkError = msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('load failed');

        if (isNetworkError && retryCount < 10) {
          retryTimeout = setTimeout(
            () => { if (isMounted) setRetryCount(p => p + 1); },
            2000 * Math.min(retryCount + 1, 5)
          );
          return;
        }

        setErrorStatus(isNetworkError ? 'Off-line' : 'Network Error');
        if (retryCount < 5) { // fallback for non-network errors
          retryTimeout = setTimeout(
            () => { if (isMounted) setRetryCount(p => p + 1); },
            Math.min(1000 * Math.pow(2, retryCount), 30000)
          );
        }
      }
    };

    fetchBalance();

    // UPGRADE: restore 2-minute auto-refresh so the sidebar equity stays
    // accurate after trade closures without hammering the API.
    // Previous note "Auto-refresh removed" caused the displayed balance to
    // freeze at the initial value for the entire session.
    const interval = setInterval(fetchBalance, 2 * 60 * 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [retryCount, userId]);

  if (errorStatus) {
    return (
      <div className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20 font-bold uppercase tracking-tight',
        size === 'sm' ? 'text-[9px]' : 'text-[10px]',
      )}>
        <Unplug size={size === 'sm' ? 10 : 12} />
        <span>{errorStatus}</span>
      </div>
    );
  }

  if (!balance) {
    return (
      <div className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-800 animate-pulse h-7',
        size === 'sm' ? 'w-24' : 'w-32',
      )} />
    );
  }

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      {!hideLabel && (
        <div className={cn(
          'px-2.5 py-1 rounded-full font-bold border shrink-0',
          size === 'sm' ? 'text-[9px]' : 'text-[10px]',
          balance.isTestnet
            ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
            : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
        )}>
          {balance.isTestnet ? 'TESTNET' : 'MAINNET'}
        </div>
      )}

      <div className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-800/50 border border-zinc-700/50 font-medium whitespace-nowrap',
        size === 'sm' ? 'text-[10px] py-1' : 'text-xs',
      )}>
        <Wallet size={size === 'sm' ? 12 : 14} className="text-zinc-500" />
        <span className="text-zinc-100 font-mono italic">
          ${balance.equity.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      </div>
    </div>
  );
}