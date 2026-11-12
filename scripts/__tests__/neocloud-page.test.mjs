/**
 * The neocloud theme pages (2026-11-12): every earlier edition's condition is
 * shown, each in exactly one of four states, and the cards render them all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { neocloudThemeView, earlierState, lineageChain, EARLIER_STATES } = await import("../../lib/neocloud-page.ts");
const { NeocloudCompanyCard, NeocloudLineageSummary } = await import("../../app/components/neocloud-theme.tsx");

const TODAY = "2026-11-12";
const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const rec = {
  themes: read("data/themes.json"),
  externals: read("data/external-catalysts.json"),
  usHistory: read("data/portfolio-history.json"),
  usEvals: read("data/portfolio-evaluations.json"),
  jpHistory: read("data/jp-portfolio-history.json"),
  jpEvals: read("data/jp-portfolio-evaluations.json"),
  irFair: read("data/ir-fair-2026-catalysts.json"),
  signals: read("data/signals.json"),
  earnings: read("data/earnings-dates.json"),
  jpListed: read("data/jp-listed.json"),
  neocloud: read("data/neocloud-metrics.json"),
};
const theme = (id) => rec.themes.themes.find((t) => t.id === id);

test("committed: the earlier editions' 40 neocloud conditions each have one of the four states", () => {
  const views = ["neocloud-us", "neocloud-jp"].map((id) => neocloudThemeView(theme(id), rec, TODAY));
  const rows = views.flatMap((v) => v.cards.flatMap((c) => c.earlier));
  const history = rec.externals.filter((c) => /^neocloud-/.test(c.series ?? "") && c.edition === "history");
  assert.equal(history.length, 40);
  assert.equal(rows.length, 40, "every earlier condition is on a card, dropped companies included");
  assert.deepEqual(new Set(rows.map((r) => r.id)), new Set(history.map((c) => c.catalyst_id)));
  for (const r of rows) assert.ok(EARLIER_STATES.includes(r.state), `${r.id} has no state`);
  for (const v of views) {
    assert.equal(Object.values(v.earlier_counts).reduce((a, b) => a + b, 0), v.earlier_total);
  }
  // The 7/31 rows carry the 10/20 article's own assessment, labelled as such.
  const notes = rows.filter((r) => r.edition === "2026-07-31" && r.article_note);
  assert.ok(notes.length >= 20);
  assert.ok(notes.every((r) => r.article_note.edition === "2026-10-20" || r.next?.by === "rewrite"));
});

test("committed: the cards render every earlier condition with its state label", () => {
  for (const id of ["neocloud-us", "neocloud-jp"]) {
    const v = neocloudThemeView(theme(id), rec, TODAY);
    const html = v.cards.map((c) => renderToStaticMarkup(React.createElement(NeocloudCompanyCard, { c }))).join("");
    const shown = (html.match(/data-state="(judged|before|awaiting|replaced)"/g) ?? []).length;
    const current = v.cards.reduce((n, c) => n + (c.member ? c.current.length : 0), 0);
    assert.equal(shown, v.earlier_total + current, `${id}: one state badge per earlier and current condition`);
    const top = renderToStaticMarkup(
      React.createElement(NeocloudLineageSummary, { chain: lineageChain(theme(id)), total: v.earlier_total, counts: v.earlier_counts, byEdition: v.by_edition }),
    );
    assert.match(top, /記事の版/);
    assert.match(top, /Article editions/);
    for (const a of theme(id).lineage) assert.ok(top.includes(a.url), `lineage link ${a.url}`);
  }
});

test("states: judged first, a rewrite or a drop is replaced, else the deadline decides", () => {
  const row = (o) => ({ status: "pending", target_date: "2026-12-31", ...o });
  assert.equal(earlierState(row({ status: "miss" }), null, TODAY), "judged");
  assert.equal(earlierState(row({}), { author: "claude-fable-5-1 (chat)" }, TODAY), "replaced");
  assert.equal(earlierState(row({ superseded_reason: "7/31 版で銘柄から外れた" }), null, TODAY), "replaced");
  assert.equal(earlierState(row({}), { author: "article" }, TODAY), "before", "carried into the next edition is not replaced");
  assert.equal(earlierState(row({ target_date: "2026-10-01" }), { author: "article" }, TODAY), "awaiting");
});
