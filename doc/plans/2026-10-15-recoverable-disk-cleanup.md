# Recoverable disk cleanup — delivery state

## Outcome and boundaries

Automatically expire reproducible skill caches and finished isolated Git workspaces,
then restore them through normal use. Deliver two reviewed slices and verify actual
reclamation plus restoration on `paperclip.staging.paperclip.app`. Keep the current
storage architecture, unique work, and recovery data. Git restoration may depend
on upstream availability; skill restoration must use saved database bytes alone.

Apply dotta-kickoff, goal-poteto-style-definition, shorten-feedback-loop,
paperclip-feature-to-production, and test-it-for-real. Retain one deployment owner.

## Acceptance matrix

| Case | Required outcome |
| --- | --- |
| Old skill version, upstream unavailable | Identical restored bytes and executable modes |
| Current/active/unsettled skill version | Preserved through concurrent preparation and cleanup |
| Finished Git workspace/base, upstream advanced | Reopen at recorded commit and perform subsequent work |
| Unique files, live consumers, pending recovery | Skip cleanup |
| Restart/concurrent reopen/interrupted deletion | Recover safely and preserve lifecycle fencing |
| Upstream failure/cross-company access | Explicit failure or skip; no fallback or access widening |

## Delivery slices

1. Skill `__versions__` cache: one-hour inactivity, current/in-use protection,
   persistent access records, cross-process exclusion, hourly batches of 50.
2. Owned isolated Git workspace/base caches: 24-hour terminal-tree cooldown,
   verified exact-commit recipe before deletion, safe on-demand restoration.

Each slice gets focused tests, required repository checks, review, single-workspace
deployment at an exact SHA, dry-run inspection, measured reclamation, and ordinary
product acceptance. Rollback disables deletion and retains restoration support.

## Current state

- Checkout: `/Users/dotta/.codex/worktrees/2da2/paperclip`
- Skill PR branch: `fix/skill-version-dir-retention`, based on Devin Foley's
  [PR #16433](https://github.com/paperclipai/paperclip/pull/16433). User approved
  building on that PR. Added safety commits to its existing branch, preserving
  Devin’s original commit; latest published revision before this fix is `6385a28ce7e0ee24bf0bc5e1dc088e7f4abb9508`.
  User also authorized merging every PR from this effort after checks pass.
- Earlier proof/implementation preserved at `da754ff744` on
  `codex/recoverable-skill-cache`; do not ship its competing worker.
- Staging: `paperclip.staging.paperclip.app`, stack `stack-pool-50531a9d17dd`.
- Staging read-only recheck at 16:07 UTC: 71% disk used, 103,676,784,640 bytes
  used, 43,621,777,408 available. Serving `7ec6fd09725fdcd771425e31ce900f8db9aae07d`.
  This task has not deployed or deleted staging data.
- A temporary Railway key named `paperclip-cleanup-acceptance-2026-10-15` is
  registered under the prior explicit approval. Revoke it and remove both local
  copies at acceptance completion (paths retained in private task evidence).
- Existing unresolved staging runs have missing skill-version pins. The approved
  conservative policy skips that company; do not clear recovery or weaken the
  guard to obtain reclamation. Qualify the skill slice with a disposable pinned
  fixture and report the legacy-data gap separately.
- Integrated one worker, cross-process preparation/pin locks, separate last-use
  metadata, legacy observation grace, unresolved-recovery protection, dry run,
  bounded scans/continuations, and deletion outside the preparation lock.
- First integrated run: 22 focused tests passed; broader controls passed 100/101.
  Removed an unnecessary explicit-deletion lock exposed by the rollback fixture;
  that control passed on rerun (12.21s). The original failure remains in
  `/tmp/paperclip-skill-integration-controls.log`.
- Full typecheck initially found a plugin dependency API mismatch from the
  unlocked bootstrap install. Current master supplied the refreshed lockfile;
  frozen install completed in 18.7s and full typecheck passed in 59.82s.
- Review at `5eb505ff5d` was 3/5: unsafe skill roots blocked the company sweep,
  and recursive byte counts held the preparation lock. Both fixed locally;
  18 affected tests passed in 24.94s, including preparation during a paused file
  walk and fresh pin revalidation. Server typecheck passed after those fixes.
- Full tests were stopped after approximately four minutes to address review
  findings before final qualification; no full-suite pass claimed. Full build at
  `d153929d70` passed. CI at that SHA passed all but the empty-runtime suite and
  Greptile (4/5). The remaining review finding was repeated company-wide pin
  queries; batching reads twice per sweep phase fixes it and has a query-count
  regression. The empty-selection fast path now returns before locking.
- Final affected skill/heartbeat controls: 35 tests passed in 29.17s, log
  `/tmp/paperclip-skill-final-controls.log`. A prior local attempt could not start
  Postgres because macOS shared-memory slots were full; retry succeeded after a
  slot became available, without changing global limits or unrelated services.
  Full typecheck on `666c60c859` passed in 32.98s. Full tests are still running;
  initial native-session cases hit the same infrastructure limit. Removed 19
  abandoned 56-byte IPC headers only after verifying zero attachments and dead
  creator/last-user PIDs. Live databases and their files were untouched.
- Review round four accepted batched reads but found unbounded per-directory
  discovery stats. Discovery now uses directory-entry types and applies the cursor
  and budget before per-path inspection, including empty-root budget accounting.
  Twenty affected tests passed in 22.05s, including filesystem-call counts across
  continuation pages (`/tmp/paperclip-skill-discovery-budget.log`). Final review
  and full checks remain. Review round five found an exhausted-root continuation
  edge case; the cursor now skips completed roots before budgeting discovery.
  Twenty-one affected tests passed in 27.98s, including a page-boundary regression
  (`/tmp/paperclip-skill-continuation.log`). The server CI shard stopped with
  "The operation was canceled" and no failing assertion; investigate its timeout.
- Concurrent Git work is on `codex/recoverable-git-cache` and remains uncommitted.
  Actual runtime/service reopening now restores A after deleting the worktree,
  branch, and base while upstream is at B. A subsequent commit survives another
  reopen. The real repository/DB experiment took 6.831s; evidence is
  `/tmp/paperclip-git-recovery-candidate.json`. Expiration is not implemented yet.
- First Git baseline used a real bare remote, runtime workspace creation, a
  database row, and ordinary reopening: missing worktree restores A while its
  branch exists; missing branch restores upstream B; missing base fails. Fixture
  script `/tmp/paperclip-git-recovery-baseline.mts`, inspected output
  `/tmp/paperclip-git-recovery-baseline.json`, retained Git fixture
  `/tmp/paperclip-git-baseline-sbJWbo`. The test DB was cleaned up.
- Greptile cleared `0da71b2ca2` (all its findings resolved). Security review then
  identified repeated full-directory enumeration. Discovery now retains bounded
  directory iterators across continuations, counts root entries in its budget,
  closes abandoned iterators, and bounds company discovery. Twenty-one focused
  cases passed in 29.99s (`/tmp/paperclip-skill-streaming-final.log`); server
  typecheck passed. A new regression inspects actual directory reads/opener reuse.
- No deployed artifact or staging acceptance yet. Next: publish review fixes,
  qualify final skill SHA, then perform dry-run rollout and measured restoration.

## Feedback-loop evidence

| Question | Environment / loop | Elapsed / main wait | Result / next decision |
| --- | --- | --- | --- |
| Can this checkout run focused tests? | Local dependency setup | 43.2s install; later one-time Runner build took several minutes | Baseline manifest/lock drift required install without changing CI-owned lockfile. Warm builds are now reusable. |
| Can an older skill restore without upstream? | Existing service with real Postgres snapshots, pre-cleanup proof at baseline `57fa6b358d` | 4.83s warm test attempt; setup excluded as one-time above | Normal runtime path restored saved binary/script bytes and executable bits with fetch unavailable; proceed with cleanup. |
| Do the integrated safety cases hold? | Devin's `0f3adda980` plus local follow-up; real Postgres and filesystem | 49s from launch through inspected result, 47.23s runner (62% tests, 21% import) | 22 tests passed, server typecheck passed. Added deleted-skill and failure-budget review cases plus heartbeat controls. No cloud proof claimed. |

| Does Git reopening preserve A after upstream moves? | `5eb505ff5d`, local bare remote plus real runtime/service/database path | 6.398s setup/run/inspection script, about 9s launch through result review | Missing branch returned B; missing base failed. Preserve fixture for exact-commit restoration tests. |
| Does cleanup block preparation during a slow file walk? | Same checkout plus review fixes, two DB clients and a deliberately paused filesystem read | 24.94s affected suite, about 28s through inspected result | 18 tests pass; preparation completes while scan is paused and its new pin prevents eviction. |

## Deferred

Skill-version creation/deduplication, recovery retention, non-Git workspace expiry,
shared/operator checkout expiry, and moving storage off the webserver.
