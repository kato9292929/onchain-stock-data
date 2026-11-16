import { SelectionSection } from "../components/selection-section";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Selection: every condition, kept in its categories (formerly Selection / Catalysts / Themes). */
export default async function SelectionPage() {
  return <SelectionSection preview={5} />;
}
