import { useEffect, useState, ReactNode } from 'react';
import { Lock, ShieldAlert, Loader2, UserPlus, LogIn, BarChart2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useStore } from '../store/useStore';

const TOKEN_KEY = 'sd_session';

type AuthState =
  | { status: 'loading' }
  | { status: 'setup' }
  | { status: 'login'; username?: string }
  | { status: 'authed'; user_id: string; username: string };

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [formUser, setFormUser] = useState('');
  const [formPass, setFormPass] = useState('');
  const [formErr, setFormErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const bootstrap = async () => {
    setState({ status: 'loading' });
    const token = localStorage.getItem(TOKEN_KEY);
    try {
      if (token) {
        const me = await fetch('/api/auth/me');
        if (me.ok) {
          const data = await me.json();
          applyAuthed(data.user_id, data.username);
          return;
        }
        localStorage.removeItem(TOKEN_KEY);
      }
      const stat = await fetch('/api/auth/status');
      if (!stat.ok) {
        setState({ status: 'setup' });
        return;
      }
      const data = await stat.json();
      setState(data.initialized ? { status: 'login', username: data.username } : { status: 'setup' });
    } catch {
      setState({ status: 'setup' });
    }
  };

  const applyAuthed = (user_id: string, username: string) => {
    setState({ status: 'authed', user_id, username });
    useStore.setState({
      userId: user_id,
      authUsername: username,
      logoutFn: logout,
    });
  };

  const logout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    localStorage.removeItem(TOKEN_KEY);
    useStore.setState({ userId: 'demo-user', authUsername: null, logoutFn: null });
    setFormUser('');
    setFormPass('');
    await bootstrap();
  };

  useEffect(() => { bootstrap(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(null);
    if (!formUser.trim() || !formPass) {
      setFormErr('Username and password required.');
      return;
    }
    setSubmitting(true);
    try {
      const isSetup = state.status === 'setup';
      const res = await fetch(isSetup ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: formUser.trim(), password: formPass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      localStorage.setItem(TOKEN_KEY, data.token);
      setFormPass('');
      applyAuthed(data.user_id, data.username);
    } catch (err: any) {
      setFormErr(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-500" size={32} />
      </div>
    );
  }

  if (state.status === 'authed') {
    return <>{children}</>;
  }

  const isSetup = state.status === 'setup';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl"
      >
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-14 h-14 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20 mb-5">
            <BarChart2 className="text-zinc-950" size={28} strokeWidth={3} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">SignalDeck</h1>
          <p className="text-zinc-500 text-sm">
            {isSetup
              ? 'Create your account to get started.'
              : `Sign in${state.username ? ` as ${state.username}` : ''}.`}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Username</label>
            <input
              type="text"
              value={formUser}
              onChange={e => setFormUser(e.target.value)}
              autoComplete="username"
              autoFocus
              placeholder={isSetup ? 'pick a username (min 3 chars)' : 'enter your username'}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Password</label>
            <input
              type="password"
              value={formPass}
              onChange={e => setFormPass(e.target.value)}
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              placeholder={isSetup ? 'pick a password (min 8 chars)' : 'enter your password'}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
            />
          </div>

          <AnimatePresence>
            {formErr && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400"
              >
                <ShieldAlert size={14} />
                {formErr}
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="submit"
            disabled={submitting}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-3 font-bold rounded-xl transition-all active:scale-[0.98]',
              'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 disabled:bg-zinc-800 disabled:text-zinc-600 shadow-lg shadow-emerald-500/20'
            )}
          >
            {submitting ? (
              <Loader2 className="animate-spin" size={18} />
            ) : isSetup ? (
              <><UserPlus size={18} /> Create account</>
            ) : (
              <><LogIn size={18} /> Sign in</>
            )}
          </button>
        </form>

        {isSetup && (
          <div className="mt-6 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl text-[11px] text-amber-300/80 leading-relaxed flex items-start gap-2">
            <Lock size={14} className="shrink-0 mt-0.5 text-amber-400" />
            <p>
              This will be the only account for this SignalDeck instance. Pick credentials you'll
              remember — there's no email reset flow.
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
