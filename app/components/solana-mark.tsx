/**
 * Solana logomark (the three slanted bars), inline so it stays crisp at any
 * size and needs no asset pipeline. Used to mark the payment rail: every paid
 * endpoint settles in USDC on Solana.
 *
 * Trademark of Solana Foundation, shown here only to indicate the chain
 * payments settle on — osd is not affiliated with or endorsed by Solana.
 *
 * `title` is rendered as an accessible name; pass `title={null}` when the mark
 * sits next to a text label that already says "Solana" (decorative).
 */
export function SolanaMark({
  className = "h-5 w-auto",
  title = "Solana",
}: {
  className?: string;
  title?: string | null;
}) {
  // A fixed id, not a generated one: every instance draws the same gradient
  // over the same viewBox, so sharing one definition is correct, and a random
  // id would differ between the server render and hydration.
  const gradientId = "solana-mark-gradient";

  return (
    <svg
      viewBox="0 0 398 312"
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title ?? undefined}
      fill={`url(#${gradientId})`}
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient
          id={gradientId}
          x1="360.879"
          y1="-37.4553"
          x2="141.213"
          y2="383.294"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
      </defs>
      <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
      <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
      <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
    </svg>
  );
}
