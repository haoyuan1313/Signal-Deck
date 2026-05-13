import { useStore } from '../store/useStore';
import { cn, timeAgo, formatCurrency } from '../lib/utils';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { ArrowUpRight, ArrowDownRight, Info } from 'lucide-react';

export default function Signals() {
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

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Signal Analysis Feed</h2>
        <p className="text-zinc-500 text-sm">Real-time stream of bot logic and signal filtering.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Rejection Reasons Chart */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <h3 className="font-semibold text-lg mb-6">Filter Performance</h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
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
          <p className="text-[10px] text-zinc-500 mt-4 text-center italic">
            Distribution of signal rejection reasons across last 50 evaluations.
          </p>
        </div>

        {/* Signals List */}
        <div className="lg:col-span-2 space-y-4">
          {signals.map((signal) => (
            <div 
              key={signal.id} 
              className={cn(
                "group relative p-5 bg-zinc-900 border rounded-2xl transition-all hover:bg-zinc-800 hover:border-zinc-700",
                signal.reason === 'accepted' ? "border-emerald-500/20" : "border-zinc-800"
              )}
            >
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "p-3 rounded-xl",
                    signal.direction === 'long' ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                  )}>
                    {signal.direction === 'long' ? <ArrowUpRight size={24} /> : <ArrowDownRight size={24} />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                       <h4 className="font-bold text-lg tracking-tight">{signal.symbol}</h4>
                       <span className={cn(
                         "text-[10px] px-2 py-0.5 rounded-full font-black tracking-widest uppercase",
                         signal.reason === 'accepted' ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-500"
                       )}>
                         {signal.reason === 'accepted' ? 'Accepted' : 'Filtered'}
                       </span>
                    </div>
                    <div className="text-zinc-400 text-xs mt-0.5 font-mono">
                      Price: {formatCurrency(signal.price)} • HTF: {signal.htf_trend}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end sm:text-right">
                  <span className="text-xs text-zinc-500 font-medium">{timeAgo(signal.created_at)}</span>
                  <div className="mt-2 flex items-center gap-1.5 px-3 py-1 bg-zinc-800/80 rounded-lg text-xs font-semibold text-zinc-300">
                    <Info size={14} className="text-zinc-500" />
                    {signal.reason === 'accepted' ? 'Validation Passed' : signal.reason.replace('_', ' ')}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {signals.length === 0 && (
            <div className="p-12 text-center bg-zinc-900 rounded-2xl border border-zinc-800 text-zinc-500">
              Waiting for bot connectivity... No signals recorded.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
