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
          ? "border-amber-300 bg-amber-50 text-amber-700"
          : "border-slate-200 bg-slate-50 text-slate-500"
      }`}
    >
      <span className="font-bold">source:</span> {source} ·{" "}
      <span className="font-bold">updated_at:</span> {updatedAt}
      {note && <div className="mt-1 opacity-80">{note}</div>}
    </div>
  );
}
