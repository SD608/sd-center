# SD Achievement Content Move / Legacy Backfill v1

Status: Chapter 3-4 candidate. DEV/code/CI only. Production remains unapplied until the Chapter 3 release gates explicitly approve deployment.

## Scope

Chapter 3-4 performs the first real producer cutover from the Chapter 3-2 classification and Chapter 3-3 common Core event/stat registry.

The exact permanent achievement identities moved from the historical Flea PC gameplay producer to `official.sta` are:

`flea-01`, `flea-02`, `flea-03`, `flea-04`,
`flea-08`, `flea-09`, `flea-10`, `flea-11`,
`flea-14`, `flea-15`, `flea-16`, `flea-17`, `flea-18`.

The UUID/code/title identity is not recreated or renamed. Existing progress, unlock state, unlock timestamp, earned row and title reward remain permanent player assets.

## Authority boundary

Chapter 3-4 does **not** open generic client achievement submission for STA.

- `official.sta` remains `internal_only`.
- `sta.operation.accepted` remains `client_submission_allowed=false`.
- The compatibility adapter reads only server-authoritative `sd_flea_pc_*` state.
- Client-supplied progress/unlocked, local SQLite values and extension-provided reward amounts are not backfill evidence.
- Private sync/evaluation functions are not executable by `anon` or `authenticated`.

An unreviewed ZIP therefore cannot mint the moved official achievements through the new Core event contract.

## Legacy collection freeze

The reviewed Flea PC server collection contains 35 `collection_required` item keys at cutover. The migration snapshots those exact keys into `sd_achievement_sta_flea_legacy_collection_keys` and fixes `flea-11` to target 35.

This prevents a future catalog addition from silently changing the meaning or difficulty of the already-published permanent achievement. A dormant older producer path had a hard-coded target of 36 despite the reviewed catalog containing 35; Chapter 3-4 removes that direct producer path and routes both compatibility refresh names through the same frozen Core-stat adapter.

## Common Core stats

The moved identities are evaluated from nine `official.sta` stats:

- bank successes
- red-diamond discovery flag
- boxes looted
- frozen legacy collection types
- bank failures
- highest-tier discovery flag
- lowest-tier-only boxes
- maximum same-item acquired count
- maximum top-speed chase distance

The 13 bindings become `active + stat_threshold`. The binding guard also requires the selected stat to be owned by the same producer, preventing cross-producer registry drift.

## Exactly-once and backfill

`sync_sd_sta_flea_legacy_v1(user)` reconstructs a normalized snapshot from server tables and creates a deterministic event ID from the user and normalized snapshot hash.

- same server snapshot -> duplicate-only
- changed server snapshot -> one new event
- each `(event_id, stat_key)` applies once
- MAX/FLAG stats never regress
- stat evaluation occurs in the same transaction as the accepted event/stat application
- evaluator failure therefore rolls the event/stat transaction back

Existing higher player progress is not reduced. Existing unlocked state and non-null `unlocked_at` are preserved by the server-authoritative monotonic upsert helper. Chapter 3-4 does not insert, delete or rewrite `sd_user_achievements` earned rows.

## DEV verification

The migration was applied successfully to SD-Core-Dev.

Rollback-only DEV E2E verified:

- exact 13 producer bindings activated; 22 retained bindings stay shadow
- 35-key collection freeze and nine common stats
- first legacy snapshot -> one event / nine stat applications / nine Core stats
- exact retry -> duplicate-only
- changed server state -> exactly one additional event
- existing higher progress remains higher
- existing unlock timestamps remain unchanged
- threshold unlocks occur only when authoritative stats reach target
- future unrelated catalog item does not change frozen `flea-11`
- old compatibility refresh functions route through the STA event/stat path
- authenticated direct STA event forgery is rejected
- cross-producer stat binding is rejected
- fixture rollback leaves no test users/events/stats/progress/earned rows

Production was only inspected read-only while developing this candidate. At inspection time the moved 13 identities had no Production progress/earned rows and the Flea PC authority source tables contained no user rows, but these observations are not a substitute for a future migration-time baseline.

## Chapter boundary

3-4 completes the content-move/Legacy-backfill candidate and regression foundation. Production cutover is still deferred.

The next official roadmap step is Chapter 3-5 hidden-achievement reconstruction and semantics.
