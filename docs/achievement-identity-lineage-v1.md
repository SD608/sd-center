# SD Achievement Permanent Identity & Lineage v1

Status: Chapter 3-1 foundation candidate. Not a production migration yet.

## Canonical identity

Every published achievement has two permanent identifiers:

- `sd_achievements.id` — canonical UUID used by server-owned earned records.
- `sd_achievements.code` — canonical public code used by compatibility/progress paths.

Both values are permanent after publication. They must never be renamed, recycled, or replaced merely because an extension moves, is remade, or is retired.

Presentation fields such as name, description, icon, title text, sort order, hidden state, and active state may change without changing achievement identity.

## Content moves and remakes

When the player action and semantic meaning remain the same, keep the same UUID and code. Move or add the producer instead of creating a new achievement identity.

Examples:

- An achievement moves from Flea Market to STA but still represents the same accomplishment: keep the existing achievement UUID/code; migrate the producer in Chapter 3-3.
- A UI/name/description changes: keep the existing achievement UUID/code.
- A condition is made technically server-verifiable while preserving the same accomplishment: keep the existing achievement UUID/code and use monotonic/idempotent backfill where needed.

When the semantic accomplishment becomes fundamentally different, create a new UUID/code. The old achievement remains preserved as Legacy and the new achievement may point to it with `supersedes_achievement_id`.

## Lineage fields

`lineage_root_id` is the first permanent identity in a semantic lineage.

- A normal/root achievement has `lineage_root_id = id` and no `supersedes_achievement_id`.
- A genuinely new semantic successor points `supersedes_achievement_id` at the previous achievement and inherits that achievement's `lineage_root_id`.
- Cycles, self-supersede, mismatched roots, identity deletion, UUID mutation, and code rename are rejected.

Producer movement alone does not use `supersedes_achievement_id`.

## Compatibility bridge

The current system has two historical identity representations:

- `sd_user_achievements.achievement_id` references the canonical UUID.
- `sd_achievement_progress.achievement_id` stores the public achievement code as text.

Chapter 3-1 intentionally keeps the text progress key for compatibility, but adds a foreign key to `sd_achievements(code)`. This prevents orphan progress IDs and guarantees every legacy progress key resolves to a permanent canonical achievement.

Later Core/producer work should resolve through the canonical catalog rather than inventing new extension-local IDs.

## Baseline observed before this candidate

Production read-only audit on 2026-08-22:

- 99 catalog achievements, 99 active.
- 99 distinct nonblank codes; duplicate code groups: 0.
- Progress rows whose code does not resolve to the catalog: 0.
- Earned rows whose UUID does not resolve to the catalog: 0.

SD-Core-Dev before migration:

- 35 catalog achievements, 35 distinct codes.
- Orphan progress codes: 0.

The Chapter 3-1 DEV migration backfills all existing DEV catalog entries as roots without changing existing UUID/code values or user progress.

## Chapter boundaries

3-1 fixes identity invariants and the lineage model only.

3-2 will classify the existing 99 achievements by content history and decide which records keep their identity, which become Legacy, and whether any genuinely new semantic successors are needed. Existing legitimate unlocks/titles/timestamps must be preserved.

3-3 will build the common Core event/producer registry. Producer ownership/history belongs there and must not be encoded by renaming achievement IDs.
