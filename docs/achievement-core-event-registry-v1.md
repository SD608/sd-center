# Chapter 3-3 — Core achievement event/stat registry v1

## Scope

Chapter 3-3 adds the common Core ownership and audit layer for achievements without cutting over existing producers yet.

The permanent achievement identity from Chapter 3-1 and the reviewed content-migration classification from Chapter 3-2 remain authoritative inputs.

## Trust boundary

`extension_id` is routing metadata only. It is never sufficient evidence that an event is genuine.

The only future authenticated ingress is `submit_sd_achievement_event_v1(extension_id, event_type, event_id, evidence)`. An event may reach the Core ledger only after its producer and event type are active and an explicit validator accepts and normalizes the evidence.

Chapter 3-3 intentionally registers every current event type with client submission disabled. The validator dispatcher fails closed. Chapter 3-4 must add explicit validator cases before any authenticated event type can be enabled.

Unreviewed user ZIPs therefore cannot become official achievement producers by merely copying an official `extension_id` or event name.

## Exactly-once event contract

`sd_achievement_event_ledger.event_id` is globally unique.

- first accepted request: one append-only ledger row;
- exact lost-response retry: `duplicate=true`, no second stat application;
- same `event_id` with different user / producer / event type / extension / submitted evidence: rejected as conflict;
- failed stat validation/application rolls back the event insertion atomically.

Accepted event rows and stat-event application rows are append-only.

## Common statistics

`sd_achievement_core_stats` is server/Core-owned and can aggregate accepted events with four modes:

- `sum`: monotonic accumulated amount/count;
- `max`: highest observed validated value;
- `latest`: value from the newest server timestamp only;
- `flag`: monotonic boolean 0/1 state.

Each `(user_id, stat_key)` update is serialized with a transaction advisory lock. `(event_id, stat_key)` application identity prevents duplicate increments.

Chapter 3-3 does not yet map achievements to concrete common stats. Bindings use `adapter` mode until Chapter 3-4 moves each existing producer onto validated common events/stats or an explicitly retained server adapter.

## Producer registry

The initial registry contains 13 ownership groups:

- Core wallet
- Core/server gold
- Logistics
- Miner
- Mukjjippa
- Slot
- Odd/Even
- Bitcoin
- STA
- Flea Market
- NPC Vault
- SD Coin
- Season finalization

The 13 Flea PC robbery/loot/chase achievements classified in Chapter 3-2 are bound to `official.sta` as `planned_move`. Retained achievements are `shadow`. No binding is `active` in Chapter 3-3.

## Security

All seven Chapter 3-3 tables have RLS enabled, explicit client-deny policies, and no direct privileges for `anon` or `authenticated`.

Private acceptance/stat/validator functions are not executable by clients. The public submission function is executable only by authenticated users, but Chapter 3-3 rejects every new submission because no event type has a validated ingress enabled.

Validator dispatch must remain explicit. Dynamic SQL/function execution based on a client or registry-supplied validator name is prohibited.

## Player asset preservation

The migration does not insert/update/delete:

- `sd_achievements` player-facing catalog identity/state;
- `sd_achievement_progress`;
- `sd_user_achievements`.

Existing UUID/code, progress, unlock state, unlock timestamp and title rewards are preserved. Producer cutover and backfill are Chapter 3-4 work.

## DEV verification

The SD-Core-Dev migration was applied successfully in shadow mode.

Current DEV foundation after migration:

- producers: 13
- event types: 13
- bindings: 35/35 DEV catalog
- planned moves: 13
- shadow bindings: 22
- active bindings: 0
- client-enabled event types: 0
- accepted common events: 0 after rollback fixture cleanup
- common stats: 0 after rollback fixture cleanup

Rollback-only E2E covers exact retry, conflicting replay, SUM/MAX/LATEST/FLAG behavior, extension spoof rejection, negative stat rejection, atomic rollback, append-only audit records, binding-target guard and authenticated fail-closed ingress.

## Production boundary

Chapter 3-1/3-2/3-3 migrations are not applied to Production in this chapter. Production remains read-only until the Chapter 3 migration/cutover sequence is ready.

## Next chapter

Chapter 3-4 installs explicit validators/adapters, performs Legacy/backfill work, moves the reviewed Flea PC producer set to STA, and proves monotonic/idempotent preservation before any production cutover.
