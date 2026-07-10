# JIN Solana feePayer 保証 — 移植指示書（OSD同型・動的取得＋fallback）

作成: 2026-07-10 / 対象リポ: JIN（private・本セッション読取不可） / コピー元: OSD `lib/x402.ts`
前提: AA policy 修正（`c4b673b`）適用済み。**これが最後の残タスク。** これが入って初めて pay→200 実測に進める。

## 0. なぜ要るか（1行）

AA policy 修正で v1 `"solana"` leg が段階3を生き残る → v1 svm client が `extra.feePayer` を**必須**で読む（無いと `"feePayer is required"` で throw）。feePayer は**ローテーションする**ので固定禁止。JIN 本番の Solana v1 leg に、**402構築時に動的取得した feePayer** を必ず載せる。

## 1. 移植する OSD 実装（`lib/x402.ts` からそのまま。ここが正）

```ts
// 直近観測の last-known-good（2026-07-09）。fresh deploy でも空にしないための floor。
const DEFAULT_SOLANA_FEE_PAYER = "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4";

const FEE_PAYER_TTL_MS = 3 * 60 * 1000;   // 3分。回転を数分で拾える程度に短く
let feePayerCache: { value: string; expires: number } | null = null;

/** env / hardcoded last-known-good。絶対に空を返さない。 */
export function solanaFeePayerFallback(): string {
  return (
    process.env.X402_SOLANA_FEE_PAYER ||
    process.env.PAYAI_FEE_PAYER ||
    DEFAULT_SOLANA_FEE_PAYER
  );
}

/** PayAI /supported の solana kind の extra.feePayer を取る。失敗は null。 */
async function fetchSolanaFeePayer(): Promise<string | null> {
  try {
    const res = await fetch("https://facilitator.payai.network/supported", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;                       // 401/403 は §5 の注記へ
    const data = await res.json();
    for (const kind of data?.kinds ?? []) {         // 形: { kinds:[{network,scheme,extra}], ... }
      const net = typeof kind?.network === "string" ? kind.network : "";
      const fp = kind?.extra?.feePayer;
      if (net.startsWith("solana") && typeof fp === "string" && fp) return fp;
    }
  } catch {
    // 到達不能 / rate-limit / 形状ドリフト → fallback
  }
  return null;
}

/** live → cache → last-known-good → env/hardcoded。必ず解決する（402を止めない）。 */
export async function getSolanaFeePayer(): Promise<string> {
  const now = Date.now();
  if (feePayerCache && feePayerCache.expires > now) return feePayerCache.value;
  const fresh = await fetchSolanaFeePayer();
  if (fresh) {
    feePayerCache = { value: fresh, expires: now + FEE_PAYER_TTL_MS };
    return fresh;
  }
  if (feePayerCache) return feePayerCache.value;    // stale-but-known > static
  return solanaFeePayerFallback();
}
```

> **OSD 版との唯一の差:** OSD は既に `payaiFacilitatorClient` を持っているので `fetchSolanaFeePayer` はそれの `getSupported()` を呼ぶ。**JIN はその client を持っていない可能性が高いので、上記は自己完結の raw `fetch('/supported')` 版**にしてある。返る JSON の形（`{ kinds:[{network,scheme,extra:{feePayer}}], extensions, signers }`）は `@x402/core` httpFacilitatorClient が `getSupported` で叩くのと同一エンドポイント・同一スキーマ（実コードで確認済み）。JIN に PayAI HTTPFacilitatorClient があるなら、raw fetch の代わりにそれの `getSupported()` を使ってよい（auth 対応が楽）。

## 2. 402 ビルダーに feePayer を通す

v1 `"solana"` leg の `extra` に **必ず** `feePayer` を入れる。402構築のハンドラで:

```ts
const feePayer = await getSolanaFeePayer();   // ← 402を組む直前に解決
// ... v1 leg を組むところで:
extra: { feePayer, resource },                // feePayer は常に非空（§1 の fallback 保証）
```

leg の骨格（`scheme:"exact"`, `network:"solana"`, `maxAmountRequired:"20000"`, `payTo`, `asset`, `maxTimeoutSeconds:300`）は静的のまま。**変わるのは extra.feePayer が「毎回解決した値」になること**だけ。ビルダー関数は feePayer を引数で受ける形にして、テスト時は固定値を渡せるようにするのが望ましい（OSD の `buildSolanaAcceptsV1(..., feePayer = solanaFeePayerFallback())` と同型）。

## 3. env（Vercel / Railway）

- `X402_SOLANA_FEE_PAYER=2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4`（**fallback用**。通常は live 取得が使われる。必須値源ではない）
- 本番は毎回 `getSolanaFeePayer()` が facilitator から鮮度取得するので、env が腐っても live が優先。到達不能時の floor として機能。

## 4. 検証（JIN 側で）

1. `tsc --noEmit` = 0、既存テスト green。ビルダーに固定 feePayer を渡す単体テストを1本（`extra.feePayer` が両legに入る）。
2. **curl で本番/プレビュー 402 を採取** → v1 `"solana"` leg の `extra.feePayer` が**非空**で入っていること。sandbox/CI が PayAI に到達できなくても fallback で必ず入る（＝ここが空なら移植ミス）。
3. AA 再デプロイ済みの状態で **pay→200 実測** → solscan で `6JKVug…`→`4s8XQC…` の着金（`20000`=0.02 USDC 等、base58 tx, Success）。← ここで初めて Solana pay→200 完了。
4. verify で落ちたら `invalidReason` を最初に見る（feePayer 不一致 / amount / nonce の切り分け）。

## 5. 注記・落とし穴

- **feePayer を固定/env-onlyにしない。** 回転した瞬間、古い名義で partial-sign した tx を PayAI が完成できず settle 不能（＝先週の「気づいたら壊れてた」の再生産）。動的取得＋fallback が必須。
- **`/supported` が 401/403 を返す場合** = PayAI が auth を要求している。その時は raw fetch でなく、JIN 側の PayAI HTTPFacilitatorClient（auth ヘッダ付き）の `getSupported()` を使う。無ければ `@payai/facilitator` の `createFacilitatorConfig(...)` + `HTTPFacilitatorClient` を OSD 同型で足す。
- **live 取得の feePayer と、AA が payload に焼く feePayer は同一である必要がある。** 402 で配った feePayer で AA が tx を組むので、402構築時の1回の解決値をそのまま extra に載せていれば整合する（キャッシュ TTL 内は同一値）。
- **v2 CAIP-2 leg は現行AAには効かない**（body が v1 → v2 leg は段階2で脱落）。JIN が併記するのは自由だが、pay→200 を担うのは v1 `"solana"` leg。feePayer は v1 leg に確実に。

## 6. 確定値

- payTo: `4s8XQC2WzRfgH8Xiep7ybnCW11VKRCMwxQF6jknx3VPf`
- Solana USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- facilitator: `https://facilitator.payai.network`
- feePayer last-known-good（fallback floor）: `2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4`（ローテーションするので floor 扱い）
- JIN movers 金額: `"20000"`（0.02 USDC, 6桁）
- AA署名（Solana, 払う側）: `6JKVugbVRXR92sacDzgxBU6k6Mb9AAhxLbEy3DyWvEzA`

## 7. これが済んだら

AA policy 修正（`c4b673b`, 済）＋ 本 feePayer 保証（JIN）が揃う → **pay→200 実測 → solscan 着金**。これで Solana 決済が3プロダクト横断で通る状態になる。着金確認までは「完了」と書かない。
