/**
 * Seamless CSS marquee of the rails osd actually runs on (honest — no
 * fabricated "customer" logos). Pure @keyframes (globals.css), pauses on hover,
 * edge-masked. The track is rendered twice for a seamless -50% loop.
 */

type Rail = { label: string; sub: string; gradient: string };

const RAILS: Rail[] = [
  { label: "Claude", sub: "Anthropic", gradient: "from-orange-300 to-amber-500" },
  { label: "x402", sub: "pay-per-call", gradient: "from-sky-300 to-blue-600" },
  { label: "Base", sub: "settlement", gradient: "from-blue-400 to-indigo-600" },
  { label: "Solana", sub: "settlement", gradient: "from-purple-400 to-emerald-400" },
  { label: "USDC", sub: "stablecoin", gradient: "from-sky-400 to-cyan-500" },
  { label: "Next.js", sub: "app", gradient: "from-slate-400 to-slate-800" },
  { label: "Vercel", sub: "hosting", gradient: "from-slate-500 to-black" },
  { label: "Ethereum", sub: "EVM", gradient: "from-indigo-300 to-purple-500" },
];

function RailCard({ rail }: { rail: Rail }) {
  return (
    <div className="group relative mx-2 flex h-24 w-40 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/60 bg-white shadow-sm transition-all hover:border-slate-300">
      <div
        className={`absolute inset-0 scale-150 bg-gradient-to-br opacity-0 transition-all duration-500 group-hover:scale-100 group-hover:opacity-100 ${rail.gradient}`}
      />
      <div className="relative z-10 flex flex-col items-center transition-colors">
        <span className="font-outfit text-lg font-semibold text-[#0a1b33] group-hover:text-white">
          {rail.label}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-slate-400 group-hover:text-white/80">
          {rail.sub}
        </span>
      </div>
    </div>
  );
}

export function RailMarquee() {
  return (
    <div className="osd-marquee osd-marquee-mask mx-auto w-full max-w-[1400px] overflow-hidden py-2">
      <div className="osd-marquee-track">
        {[...RAILS, ...RAILS].map((r, i) => (
          <RailCard key={i} rail={r} />
        ))}
      </div>
    </div>
  );
}
