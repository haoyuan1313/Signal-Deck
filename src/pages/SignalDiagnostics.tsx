import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useStore } from '../store/useStore';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

export default function SignalDiagnostics() {
  const { signals } = useStore();

  const rejectionStats = signals.reduce((acc: any, s) => {
    if (s.reason === 'accepted') return acc;
    acc[s.reason] = (acc[s.reason] || 0) + 1;
    return acc;
  }, {});

  const pieData = Object.entries(rejectionStats).map(([name, value]) => ({
    name: name.replace('_', ' ').toUpperCase(),
    value
  }));

  const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#6366f1', '#ec4899', '#71717a'];

  const acceptedCount = signals.filter(s => s.reason === 'accepted').length;
  const totalCount = signals.length;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Signals', value: totalCount },
          { label: 'Accepted', value: acceptedCount },
          { label: 'Rejected', value: totalCount - acceptedCount },
        ].map(({ label, value }) => (
          <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{label}</span>
            <div className="text-3xl font-bold font-mono tracking-tight mt-2">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <h3 className="font-semibold text-lg mb-6">Filter Performance</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '12px' }}
                />
                <Legend layout="horizontal" verticalAlign="bottom" align="center" iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <h3 className="font-semibold text-lg mb-6">Recent Signal Activity</h3>
          <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar">
            {signals.slice(0, 20).map(signal => (
              <div
                key={signal.id}
                className="flex items-center justify-between p-3 bg-zinc-800/30 border border-zinc-800/50 rounded-xl"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-bold text-white">{signal.symbol}</span>
                  <span className={`text-[10px] font-bold uppercase ${signal.direction === 'long' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {signal.direction}
                  </span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-lg font-bold uppercase ${
                  signal.reason === 'accepted'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-zinc-700/30 text-zinc-500 border border-zinc-700/50'
                }`}>
                  {signal.reason}
                </span>
              </div>
            ))}
            {signals.length === 0 && (
              <p className="text-zinc-600 text-center py-12 italic">No signals recorded yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
