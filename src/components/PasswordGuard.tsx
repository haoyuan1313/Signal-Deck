import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { Lock, Unlock, ShieldAlert, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface PasswordGuardProps {
  children: React.ReactNode;
}

export default function PasswordGuard({ children }: PasswordGuardProps) {
  const { isAuthenticated, setAuthenticated } = useStore();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const masterPassword = (import.meta as any).env.VITE_MASTER_PASSWORD;

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifying(true);
    setError(false);

    // If master password isn't set, we warn but allow? Or should we block?
    // Let's assume it MUST be set for this to work properly.
    if (!masterPassword) {
      console.warn('VITE_MASTER_PASSWORD is not set in environment variables.');
      // For development, if not set, let it pass to avoid blocking user
      setAuthenticated(true);
      return;
    }

    if (password === masterPassword) {
      setTimeout(() => {
        setAuthenticated(true);
        setIsVerifying(false);
      }, 500);
    } else {
      setTimeout(() => {
        setError(true);
        setIsVerifying(false);
        setPassword('');
      }, 500);
    }
  };

  if (isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl"
      >
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-6 border border-emerald-500/20">
            <Lock className="text-emerald-400" size={32} />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2 underline decoration-emerald-500/30 decoration-4 underline-offset-4">Secure Area</h2>
          <p className="text-zinc-500 text-sm">This section is password protected. Please enter the master password to continue.</p>
        </div>

        <form onSubmit={handleVerify} className="space-y-4">
          <div className="space-y-2">
            <div className="relative group">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                placeholder="Enter Password"
                className={cn(
                  "w-full bg-zinc-800 border-2 rounded-2xl px-5 py-4 focus:outline-none transition-all font-mono",
                  error 
                    ? "border-rose-500/50 focus:border-rose-500 bg-rose-500/5" 
                    : "border-zinc-700/50 focus:border-emerald-500/50"
                )}
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-emerald-500/50 transition-colors">
                <Unlock size={20} />
              </div>
            </div>
            
            <AnimatePresence>
              {error && (
                <motion.p 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="text-rose-500 text-xs font-bold flex items-center gap-2 px-2"
                >
                  <ShieldAlert size={14} />
                  Incorrect password. Please try again.
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <button
            type="submit"
            disabled={!password || isVerifying}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-bold py-4 rounded-2xl transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {isVerifying ? (
              <Loader2 className="animate-spin" size={20} />
            ) : (
              <>
                <ShieldAlert size={18} />
                <span>Verify Identity</span>
              </>
            )}
          </button>
        </form>

        {!masterPassword && (
          <div className="mt-8 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl text-amber-500/80 text-[10px] leading-relaxed">
            <p><strong>Dev Note:</strong> <code>VITE_MASTER_PASSWORD</code> is not defined. Any input will be accepted for now, or you can set it in your environment variables.</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
