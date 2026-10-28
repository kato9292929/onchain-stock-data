/**
 * Errors where carrying on can only reproduce the same failure, once per
 * remaining item. The 2026-09-23 research run hit "credit balance is too low"
 * on company 13 of 13; had it landed on company 3, the other ten would each
 * have spent a request to learn the same thing. The 2026-10-25 evaluate run
 * hit `401 invalid x-api-key` on every catalyst and still exited 0.
 *
 * Shared by the scripts that call the API in a loop (plain `node`, so this is
 * .mjs and has no dependencies).
 */
export function isFatalRunError(e) {
  const status = e?.status ?? e?.response?.status;
  if (status === 401 || status === 403) return true;
  return /credit balance is too low|billing|quota|rate limit|invalid x-api-key|authentication_error|permission_error/i.test(
    String(e?.message ?? ""),
  );
}
