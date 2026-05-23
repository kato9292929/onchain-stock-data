export function DataBanner({
  source,
  note,
  updatedAt,
}: {
  source: string;
  note?: string;
  updatedAt: string;
}) {
  const isSample = source === "sample-data";
  return (
    <div
      className={`text-xs px-3 py-2 rounded border mb-4 ${
        isSample
          ? "border-amber-500/40 bg-amber-500/5 text-amber-200"
          : "border-zinc-800 bg-zinc-900/60 text-zinc-400"
      }`}
    >
      <span className="font-bold">source:</span> {source} ·{" "}
      <span className="font-bold">updated_at:</span> {updatedAt}
      {note && <div className="mt-1 opacity-80">{note}</div>}
    </div>
  );
}
