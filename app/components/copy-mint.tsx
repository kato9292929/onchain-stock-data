"use client";

import { useState } from "react";

/** A Solana mint, shortened for display, copied in full on click. */
export function CopyMint({ mint, full = false }: { mint: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  const label = full ? mint : `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  return (
    <button
      type="button"
      title={`Copy ${mint}`}
      aria-label={`Copy mint ${mint}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(mint);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard blocked — the full mint is still in the title */
        }
      }}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-600 hover:border-slate-300"
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 text-[10px] text-slate-400">{copied ? "copied" : "copy"}</span>
    </button>
  );
}
