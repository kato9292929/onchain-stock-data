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
