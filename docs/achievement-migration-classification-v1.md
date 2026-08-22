# SD Achievement Migration Classification v1

Status: Chapter 3-2 candidate. DEV/code/CI only until the Chapter 3 migration gates approve Production deployment.

## Result

The current official 99-achievement catalog was reviewed against the roadmap, current server-authoritative producer work, and the current catalog semantics.

- 99/99 identities are preserved.
- 86 are `retain`.
- 13 are `move_producer`: the Flea PC gameplay/robbery/loot achievement set planned to move to STA.
- 0 are marked `legacy` in Chapter 3-2.
- 0 require a new semantic successor in Chapter 3-2.

`move_producer` does **not** rename or recreate an achievement. The same UUID/code, existing unlock, unlock timestamp, and title reward remain authoritative. Chapter 3-3/3-4 will implement the actual producer registry/cutover and backfill.

## Flea PC -> STA producer/content move

The exact 13 codes are:

`flea-01`, `flea-02`, `flea-03`, `flea-04`,
`flea-08`, `flea-09`, `flea-10`, `flea-11`,
`flea-14`, `flea-15`, `flea-16`, `flea-17`, `flea-18`.

These represent bank robbery, loot, collection, and chase accomplishments from the Flea PC gameplay path. The roadmap explicitly reserves STA chapter 11-5 for Flea-related achievement lineage migration. The accomplishment meaning is retained, so creating replacement IDs would incorrectly split the user's permanent record.

The marketplace-only Flea achievements remain with Flea Market:
`flea-05`, `flea-06`, `flea-07`, `flea-12`, `flea-13`, `flea-19`.

## Other groups

The following identities are retained in Chapter 3-2:
- Logistics 16
- Flea Market 6
- Miner 9
- Mukjjippa 2
- Slot 7
- Odd/Even 10
- Bitcoin 5
- STA 3
- Core Gold 3
- NPC Vault 8
- SD Coin 9
- Core Wallet 7
- Season Ranking 1

Future UI remakes or consolidation (for example Casino, Miner remake, Logistics UI, or Vault UI) do not by themselves justify a new achievement identity. If a later producer cutover is required, it must preserve the same identity unless the accomplishment meaning itself changes.

## Preservation contract

Chapter 3-2 is additive only. It must not lower, delete, or rewrite:
- `sd_achievements.id` / `code`
- existing catalog presentation or active/hidden state
- `sd_achievement_progress.current_value`
- `sd_achievement_progress.unlocked` / `unlocked_at`
- `sd_user_achievements` earned rows / `unlocked_at`
- achievement title rewards

The classification table has mandatory preservation flags and is not writable by `anon` or `authenticated`.

## Chapter boundary

3-2 classifies content history and preservation only. It does not switch producers.

3-3 creates the common Core event/producer registry.
3-4 performs the gated producer move / Legacy-backfill implementation with monotonic and idempotent regression.
3-5 handles hidden-achievement UI/semantics separately.
