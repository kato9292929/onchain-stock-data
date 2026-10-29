// Delivery Receipt public keys (keys[], refetch_window_s, refetch_header). Spec: lib/delivery-receipt/README.md.
import { wellKnownResponse } from "@/lib/delivery-receipt";
import { receiptSeller } from "@/lib/receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async () => wellKnownResponse(receiptSeller());
