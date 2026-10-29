// At server start, check the Delivery Receipt signing key: without RECEIPT_SIGNING_KEY the server does not start.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { receiptSeller } = await import("./lib/receipts");
  receiptSeller();
}
