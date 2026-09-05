"use client";

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import type { PerformanceRecord } from "@/lib/data";

/**
 * Claude Portfolio vs SPY / QQQ, all rebased to 100 at inception.
 * Ported from Claude-Stock-Portfolio-Watch's recharts PerformanceChart.
 */
export function PerformanceChart({ records }: { records: PerformanceRecord[] }) {
  if (!records || records.length === 0) {
    return (
      <p className="text-sm text-slate-400">パフォーマンスデータがありません。</p>
    );
  }

  const data = records.map((r) => ({
    date: r.date,
    Portfolio: r.portfolio_index,
    SPY: r.spy_index,
    QQQ: r.qqq_index,
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 11 }} minTickGap={24} />
          <YAxis
            stroke="#94a3b8"
            tick={{ fontSize: 11 }}
            domain={["auto", "auto"]}
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: "#475569" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="Portfolio" stroke="#0ea5e9" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="SPY" stroke="#94a3b8" dot={false} strokeWidth={1.5} />
          <Line type="monotone" dataKey="QQQ" stroke="#f59e0b" dot={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
