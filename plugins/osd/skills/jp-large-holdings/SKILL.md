---
name: jp-large-holdings
description: List the large-holding reports (大量保有報告書 and 変更報告書) filed on a Japanese company's shares — who crossed 5% and who changed their stake, newest first, from EDINET. Use when the user asks who is buying or selling a Japanese stock, about activist or institutional stakes, or gives a TSE code (e.g. 6871, 9984, 285A).
argument-hint: "[TSE code]"
---

# Japan large-holding reports (OSD)

1. Call the OSD MCP tool `large_holdings` with `code` from `$ARGUMENTS` (a 4-character TSE code). Use `days: 180` unless the user asks for a longer window (max 400).
2. Show a table, newest first: submitted (date), holder, kind (initial = 大量保有報告書 / change = 変更報告書), document id.
3. Summarise in two or three lines: how many reports, which holders appear more than once, and the latest one.
4. Say that holding ratios are not served yet (only the filing list), and that every row is 出典：金融庁 EDINET.

If the tool returns `no_large_holding_reports`, say none were filed in the window. If it returns an error, report it as is. Not investment advice.
