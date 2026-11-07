// Delivery Receipt public keys (keys[], refetch_window_s, refetch_header). Spec: https://github.com/kato9292929/delivery-receipt (docs/spec.md).
import { wellKnownResponse } from "@x402jp/delivery-receipt-seller";
import { receiptSeller } from "@/lib/receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async () => wellKnownResponse(receiptSeller());
