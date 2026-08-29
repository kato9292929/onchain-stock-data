import type { IrFairCatalyst, IrFairFile } from "./ir-fair-scoreboard";

/**
 * Sector model for the redesigned /catalysts.
 *
 * The catalyst board has two universes:
 *   - "Physical AI" — the existing editorial 6-article series (US + Japan
 *     physical-AI names). Kept as ONE coherent, already-scored section.
 *   - "IR Fair 2026" — the ~190 Nikkei×TSE exhibitors, bundled from their TSE
 *     33-sector into the meta-themes below (analysis from the work order §4).
 *
 * /catalysts is a short INDEX of these sectors; each sector has its own page
 * (/catalysts/[slug]) with an analysis header, its scored catalysts, and its
 * IR-Fair roster (company names, draft = condition pending, never scored).
 */

export interface CatalystSector {
  slug: string;
  title_en: string;
  title_ja: string;
  /** Judgement type: Earnings / IR event / Policy / Mission / Meta. */
  decision_type: string;
  /** 1-2 line "切り口" shown in the sector page header (§4). */
  analysis: string;
  /** TSE 33-sectors that default into this meta-theme. */
  tse_sectors: string[];
}

/** The IR-Fair meta-themes (index order). */
export const SECTORS: CatalystSector[] = [
  {
    slug: "semiconductors-fa",
    title_en: "Semiconductors · FA · Equipment",
    title_ja: "半導体・FA・装置",
    decision_type: "Earnings",
    analysis:
      "①決算。AI装置・部材の数量で判定。ロボット関節（減速機）から工程材料・計測まで、既存ポートの装置株と工程の連鎖で読む。",
    tse_sectors: ["機械", "電気機器", "金属製品", "ガラス・土石製品", "精密機器"],
  },
  {
    slug: "datacenter-power",
    title_en: "Data centers · Power",
    title_ja: "データセンター・電力インフラ",
    decision_type: "Policy + Earnings",
    analysis:
      "③政策＋①決算。「AIのボトルネックは電力」。データセンタ建設受注・電力設備投資・空調で判定。",
    tse_sectors: ["電気・ガス業"],
  },
  {
    slug: "payments-edge-dx",
    title_en: "Payments · Edge AI · Field DX",
    title_ja: "決済・エッジAI・現場DX",
    decision_type: "IR event + Earnings",
    analysis:
      "②IRイベント＋①決算。x402／エージェント決済の本流に接続。中計・提携・受注の発表で判定。",
    tse_sectors: ["情報・通信業"],
  },
  {
    slug: "space-geospatial",
    title_en: "Space · Geospatial",
    title_ja: "宇宙・空間情報",
    decision_type: "Mission",
    analysis:
      "④ミッション。打ち上げ・軌道投入・観測マイルストン＝日付が確定した二値イベント。dated 適性が最も高い。",
    tse_sectors: ["空運業"],
  },
  {
    slug: "infrastructure",
    title_en: "Infrastructure resilience",
    title_ja: "インフラ老朽化・国土強靱化",
    decision_type: "Policy",
    analysis:
      "③政策。国土強靱化・補正予算を起点に、受注・中計で判定。低PBR×高配当が厚いセクター。",
    tse_sectors: ["建設業"],
  },
  {
    slug: "financials",
    title_en: "Financials · Shareholder returns",
    title_ja: "金融・株主還元",
    decision_type: "Earnings + Capital policy",
    analysis:
      "①決算(NII)＋②資本政策。金利上昇による利ざや改善と、政策保有株削減・株主還元強化の発表で判定。",
    tse_sectors: ["銀行業", "証券、商品先物取引業", "その他金融業"],
  },
  {
    slug: "mobility",
    title_en: "Mobility · Auto parts",
    title_ja: "モビリティ・車載部品",
    decision_type: "Meta (PBR<1)",
    analysis:
      "②メタ（PBR1倍割れ改善）。事業より東証の「PBR1倍割れ改善要請」を軸に、資本効率改善の発表で読む。",
    tse_sectors: ["輸送用機器"],
  },
  {
    slug: "healthcare",
    title_en: "Healthcare · Pharma",
    title_ja: "ヘルスケア・創薬",
    decision_type: "Mission + Earnings",
    analysis:
      "④治験マイルストン（グロース勢）＋①②決算・資本政策（バリュー勢）の二層で判定。",
    tse_sectors: ["医薬品"],
  },
  {
    slug: "domestic-defensive",
    title_en: "Domestic defensives",
    title_ja: "内需ディフェンシブ",
    decision_type: "Earnings",
    analysis:
      "①決算・価格改定で判定。メタテーマ（PBR・配当）で拾うのは可。x402 文脈からは遠く優先度は低い。",
    tse_sectors: ["食料品", "水産・農林業"],
  },
  {
    slug: "materials-trading-other",
    title_en: "Materials · Trading · Other",
    title_ja: "素材・商社・その他（PBR・IR）",
    decision_type: "Meta (PBR / IR)",
    analysis:
      "横串メタテーマ。東証「PBR1倍割れ改善要請」×IR強化。IRフェア出展＝IRを強化して評価を上げに来た集団。中期経営計画・資本政策・株主還元・政策保有株削減の『発表』を二値で判定。",
    tse_sectors: [
      "化学",
      "卸売業",
      "鉄鋼",
      "非鉄金属",
      "不動産業",
      "繊維製品",
      "その他製品",
      "陸運業",
      "小売業",
      "パルプ・紙",
      "サービス業",
    ],
  },
];

/** Slug of the existing Physical-AI editorial series (kept as one section). */
export const PHYSICAL_AI_SLUG = "physical-ai";

export const SECTOR_BY_SLUG: Record<string, CatalystSector> = Object.fromEntries(
  SECTORS.map((s) => [s.slug, s]),
);

const TSE_TO_SLUG: Record<string, string> = {};
for (const s of SECTORS) for (const t of s.tse_sectors) TSE_TO_SLUG[t] = s.slug;

/**
 * Per-ticker overrides where a company sits in a different meta-theme than its
 * TSE sector's default (from §4's representative lists). E.g. DC-construction
 * names move from 建設業→datacenter, ispace moves from サービス業→space.
 */
export const TICKER_OVERRIDE: Record<string, string> = {
  "1979": "datacenter-power", // 大気社 (DC 空調)
  "1946": "datacenter-power", // トーエネック
  "1968": "datacenter-power", // 太平電業
  "1938": "datacenter-power", // 日本リーテック
  "9348": "space-geospatial", // ispace
  "9412": "space-geospatial", // スカパーJSAT
  "5262": "infrastructure", //   日本ヒューム (ヒューム管)
  "7826": "semiconductors-fa", // フルヤ金属 (貴金属→半導体)
  "2760": "semiconductors-fa", // 東京エレクトロン デバイス (半導体商社)
};

/** Map an IR-Fair company to its meta-theme slug. */
export function sectorSlugFor(tseSector: string, ticker: string): string {
  return (
    TICKER_OVERRIDE[ticker] ?? TSE_TO_SLUG[tseSector] ?? "materials-trading-other"
  );
}

export interface SectorRosterEntry extends IrFairCatalyst {
  sectorSlug: string;
}

/** TSE market display order: Prime → Standard → Growth → (unknown). */
const MARKET_RANK: Record<string, number> = {
  プライム: 0,
  スタンダード: 1,
  グロース: 2,
};
function marketRank(m?: string): number {
  return m != null && m in MARKET_RANK ? MARKET_RANK[m] : 3;
}

/** Group the IR-Fair roster by meta-theme slug, sorted market → code. */
export function rosterBySlug(file: IrFairFile): Map<string, SectorRosterEntry[]> {
  const map = new Map<string, SectorRosterEntry[]>();
  for (const c of file.catalysts) {
    const slug = sectorSlugFor(c.sector, c.ticker);
    if (!map.has(slug)) map.set(slug, []);
    map.get(slug)!.push({ ...c, sectorSlug: slug });
  }
  for (const list of map.values())
    list.sort(
      (a, b) =>
        marketRank(a.tse_market) - marketRank(b.tse_market) ||
        a.ticker.localeCompare(b.ticker),
    );
  return map;
}
