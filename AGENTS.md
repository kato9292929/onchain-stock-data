<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Branch & repo hygiene

The default branch is **`main`**. It is the production source: Vercel deploys
`main` to osd-coral.vercel.app, and the daily GitHub Actions
(`update-portfolio`, `update-performance`, `evaluate-catalysts`) commit data
back to whatever branch they run on (`${GITHUB_REF_NAME}`), i.e. `main`.

Working agreement:

- **Branch off `main`, target `main`.** Open PRs against `main`.
- **Never make an auto-generated name the default branch.** If a session
  starts on a `claude/<random-name>` branch, do not promote it to default —
  merge its PR into `main` instead.
- **Delete branches after merge.** "Automatically delete head branches" is
  enabled in repo settings; if you create extra branches, clean them up.
  Never delete `main`, and never delete an unmerged branch without owner sign-off.
- **Never rewrite history.** No rebase / force-push / history surgery on shared
  branches — production runs off this history. Duplicate/early commits are left
  as-is.
- **Keep the default branch named `main` permanently — never rename or delete it.**
  Vercel's Production deploy tracks a fixed branch name; renaming/deleting the
  default (e.g. during branch hygiene) silently detaches production so merges to
  `main` stop deploying. If the production branch ever drifts, fix it in Vercel
  → Settings → Environments → Production → Branch Tracking → `main` (and/or
  `vercel --prod` to deploy the current `main` immediately).
- **Don't hardcode the default branch name** in workflows or scripts. The cron
  workflows use `${GITHUB_REF_NAME}` so they follow the branch they run on; keep
  it that way so a future rename can't break them.
<!-- END:branch-hygiene -->

<!-- BEGIN:cost-governance -->
# Cost governance — money is managed STRICTLY, no exceptions

This project calls **paid** services (Anthropic API model calls, web search,
and any paid data API). Real money has already been wasted here by enabling
automation without guardrails. These rules are **hard constraints**, not
suggestions. When in doubt, do the cheaper/safer thing and ASK.

**The prime rule: never let cost happen silently.** Before taking any action
that can spend money, state the expected cost to the user *in advance* and get
explicit approval. Discovering a charge after the fact is a failure.

Anything that spends money — cron/scheduled jobs, `client.messages.create`,
web search, paid data APIs — is a **cost action**. For every cost action:

1. **Estimate first, out loud.** Give the user a concrete per-run and
   worst-case estimate (tokens × price, search count × price) *before*
   enabling it. No estimate → do not enable.
2. **Cheapest model that works.** Default to the cheapest viable model
   (Haiku/Sonnet before Opus). Never silently pick an expensive model for an
   automated job.
3. **Prompt caching is mandatory** on any repeated-prefix call (system prompts,
   tool loops, per-item batches). No caching → do not ship the job.
4. **No unbounded automation.** Any scheduled job must have a defined stop
   condition and must not re-process a backlog in one burst. Specifically:
   after a credit top-up or an outage, a paused/failed job re-enabling must NOT
   fire an accumulated backlog at once (this caused a $15/day spike). Add a
   guard (skip stale work / cap per-run volume) before re-enabling.

**Re-enabling a paused cost cron requires ALL of the following, in order — no
shortcuts:** (a) a spend cap is confirmed active on the account; (b) prompt
caching is in place; (c) a backlog-burst guard is in place; (d) ONE manual
`workflow_dispatch` run is executed and its real cost is measured and reported
to the user; (e) the user explicitly approves. Only then uncomment the
`schedule:`. Never re-enable a cost cron on your own initiative.

**Never enable, un-pause, or add a cost action without explicit user
approval.** "It's probably cheap" is not approval. If you cannot estimate the
cost, say so and stop.
<!-- END:cost-governance -->
