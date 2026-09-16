/**
 * MCP Inspector-style verification for the osd MCP server (`onchain-stock-data`).
 *
 * Runs the standard handshake against the Streamable-HTTP endpoint and prints
 * sample input/output for each tool, so the tool list + annotations + the
 * free/paid line can be confirmed by fact:
 *
 *   initialize → notifications/initialized → tools/list → tools/call (×4)
 *
 * Usage:
 *   # against a local dev/prod server
 *   MCP_URL=http://localhost:3000/api/mcp node scripts/mcp-inspect.mjs
 *   # against production
 *   MCP_URL=https://osd.x402jp.com/api/mcp node scripts/mcp-inspect.mjs
 *
 * The official GUI Inspector can be pointed at the same URL:
 *   npx @modelcontextprotocol/inspector
 * (Transport: "Streamable HTTP", URL: <MCP_URL>) — this script is the headless
 * equivalent for CI / a captured transcript.
 *
 * Exits non-zero (fail loud) if the handshake, tools/list, or any tool call
 * errors, if a tool is missing its title / readOnlyHint annotation, or if a
 * tool call comes back as an MCP error.
 */

const MCP_URL = process.env.MCP_URL ?? "http://localhost:3000/api/mcp";
const PROTOCOL_VERSION = process.env.MCP_PROTOCOL_VERSION ?? "2025-06-18";

let sessionId = null;
let rpcId = 0;

/** POST one JSON-RPC message; parse a JSON or SSE (text/event-stream) reply. */
async function rpc(method, params, { notify = false } = {}) {
  const body = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
  if (!notify) body.id = ++rpcId;
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;

  // Notifications and 202/204 replies carry no body.
  if (notify || res.status === 202 || res.status === 204) {
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    return null;
  }
  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} — ${raw.slice(0, 300)}`);

  let msg;
  if (contentType.includes("text/event-stream")) {
    // Take the last `data:` line's JSON payload from the SSE frame(s).
    const dataLines = raw
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    if (!dataLines.length) throw new Error(`${method}: empty SSE body`);
    msg = JSON.parse(dataLines[dataLines.length - 1]);
  } else {
    msg = JSON.parse(raw);
  }
  if (msg.error) throw new Error(`${method}: RPC error ${JSON.stringify(msg.error)}`);
  return msg.result;
}

function show(label, value) {
  console.log(`\n── ${label} ──`);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  console.log(`[mcp-inspect] target: ${MCP_URL}`);

  // 1) initialize
  const init = await rpc("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "osd-mcp-inspect", version: "0.1.0" },
  });
  show("initialize → serverInfo", init.serverInfo);
  await rpc("notifications/initialized", undefined, { notify: true });

  // 2) tools/list — assert all four tools + required annotations.
  const list = await rpc("tools/list", {});
  const tools = list.tools ?? [];
  show(
    "tools/list",
    tools.map((t) => ({
      name: t.name,
      title: t.title ?? t.annotations?.title ?? null,
      readOnlyHint: t.annotations?.readOnlyHint ?? null,
      destructiveHint: t.annotations?.destructiveHint ?? null,
    })),
  );

  const EXPECTED = ["portfolio_get", "catalysts_list", "scoreboard_get", "signal_get"];
  const names = tools.map((t) => t.name).sort();
  for (const n of EXPECTED) {
    if (!names.includes(n)) throw new Error(`tools/list missing "${n}"`);
  }
  for (const t of tools) {
    if (t.name.length > 64) throw new Error(`tool name >64 chars: ${t.name}`);
    const title = t.title ?? t.annotations?.title;
    if (!title) throw new Error(`tool ${t.name} missing title`);
    if (t.annotations?.readOnlyHint !== true) {
      throw new Error(`tool ${t.name} missing readOnlyHint:true`);
    }
    if (t.annotations?.destructiveHint !== false) {
      throw new Error(`tool ${t.name} missing destructiveHint:false`);
    }
  }

  // 3) tools/call — one sample call per tool.
  const calls = [
    ["portfolio_get", { market: "us" }],
    ["catalysts_list", { theme: "physical-ai", limit: 3 }],
    ["scoreboard_get", {}],
    ["signal_get", {}],
  ];
  for (const [name, args] of calls) {
    const result = await rpc("tools/call", { name, arguments: args });
    if (result?.isError) throw new Error(`tools/call ${name} returned isError`);
    const firstText = result?.content?.find((c) => c.type === "text")?.text ?? "";
    // Print a trimmed sample so the transcript stays readable.
    const sample = firstText.length > 700 ? firstText.slice(0, 700) + "\n… (truncated)" : firstText;
    console.log(`\n── tools/call ${name}(${JSON.stringify(args)}) ──\n${sample}`);
  }

  console.log("\n[mcp-inspect] OK — 4 tools, annotations present, all calls returned.");
}

main().catch((err) => {
  console.error(`\n[mcp-inspect] FAIL: ${err.message}`);
  process.exit(1);
});
