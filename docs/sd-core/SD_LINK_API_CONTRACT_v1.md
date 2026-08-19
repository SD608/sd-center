# SD Link ↔ SD Core API Contract v1

Status: feature branch contract. This document defines the new SD Core API surface only. It does **not** delete, rename, or change the legacy SD Link RPCs such as `push_sd_link_transaction`, `register_sd_link_device`, `get_sd_link_snapshot`, or `pull_sd_link_transactions`.

## 1. Scope

SD Core v1 is the central, always-online source of truth for account-bound wallet state and transaction ledger state. PC-local data may be used as an input source by SD Link, but the client must never overwrite the server's final wallet balance directly.

The v1 sequence is:

1. Supabase Auth login obtains a user access token.
2. The device is registered or resolved with `sd_core_register_device`.
3. Wallet writes use semantic requests through `sd_core_apply_wallet_event`.
4. Current server truth is read through `sd_core_get_snapshot`.
5. Future Core modules may reuse the same account/device/event identity model for inventory, achievements, and seasons.

## 2. Authentication

All SD Core v1 RPCs require an authenticated Supabase user session.

Required HTTP headers when calling the Supabase Data API directly:

```http
Authorization: Bearer <supabase_user_access_token>
apikey: <supabase_publishable_or_legacy_anon_key>
Content-Type: application/json
```

Rules:

- Never ship a `service_role`/secret key inside SD Link, the desktop app, website JavaScript, or mobile clients.
- The JWT establishes the account identity. The server uses `auth.uid()` and never accepts a caller-supplied `user_id` for wallet mutation.
- `device_id` is a server-issued/bound device identity, not a replacement for the JWT.
- Every wallet mutation verifies that `device_id` belongs to the authenticated user and is active/not revoked.

## 3. Device registration

RPC: `sd_core_register_device`

Data API path:

```text
POST /rest/v1/rpc/sd_core_register_device
```

Request:

```json
{
  "p_device_key": "<64 lowercase hex SHA-256 device key>",
  "p_device_name": "My Windows PC",
  "p_platform": "windows"
}
```

Allowed `p_platform` values:

- `windows`
- `android`
- `web`

Response example:

```json
{
  "ok": true,
  "device_id": "6e7464b2-1f2d-4e1e-8bd3-c31abf70b96a",
  "device_status": "active",
  "platform": "windows",
  "account_number": "608-2026-0001",
  "wallet_balance": 900000,
  "server_time": "2026-08-20T00:00:00+00:00"
}
```

Client requirements:

- Persist the returned `device_id` with the account/device binding.
- `p_device_key` stays compatible with the current 64-hex SD Link device-key shape.
- Re-registering an existing active device may refresh its name/platform/last-seen time.
- A revoked device key is not silently reactivated. Generate/re-link with a new device identity instead.

## 4. Server snapshot

RPC: `sd_core_get_snapshot`

Data API path:

```text
POST /rest/v1/rpc/sd_core_get_snapshot
```

Request:

```json
{
  "p_device_id": "6e7464b2-1f2d-4e1e-8bd3-c31abf70b96a"
}
```

Response example:

```json
{
  "ok": true,
  "device_id": "6e7464b2-1f2d-4e1e-8bd3-c31abf70b96a",
  "wallet_id": "b70f75a1-8022-46d0-9f4a-f89b86319649",
  "account_number": "608-2026-0001",
  "balance": 900000,
  "latest_sync_seq": 14820,
  "server_time": "2026-08-20T00:00:00+00:00"
}
```

`balance` from this RPC is the current server truth. SD Link must not replace it with a locally calculated final balance after the call.

## 5. Wallet event mutation

RPC: `sd_core_apply_wallet_event`

Data API path:

```text
POST /rest/v1/rpc/sd_core_apply_wallet_event
```

Request shape:

```json
{
  "p_device_id": "6e7464b2-1f2d-4e1e-8bd3-c31abf70b96a",
  "p_event_id": "4a9d913f-9cb0-43f3-8630-14b1425894c8",
  "p_event_type": "reward",
  "p_amount": 100000,
  "p_target_account_number": null,
  "p_source_app": "sd_link",
  "p_description": "Delivery reward",
  "p_metadata": {
    "local_transaction_id": "local-123"
  }
}
```

### 5.1 Required semantic rule

`p_amount` is **always a positive integer**.

The client must never encode direction by sending a negative amount. The server owns direction:

| `p_event_type` | Client amount | Server effect |
|---|---:|---:|
| `reward` | positive | `+amount` |
| `spend` | positive | `-amount` |
| `transfer` | positive | sender `-amount`, receiver `+amount` |

Negative, zero, null, or over-limit amounts are rejected.

### 5.2 `reward`

Request:

```json
{
  "p_device_id": "<device uuid>",
  "p_event_id": "<new uuid>",
  "p_event_type": "reward",
  "p_amount": 100000,
  "p_target_account_number": null,
  "p_source_app": "sd_link",
  "p_description": "Reward",
  "p_metadata": {}
}
```

### 5.3 `spend`

Request:

```json
{
  "p_device_id": "<device uuid>",
  "p_event_id": "<new uuid>",
  "p_event_type": "spend",
  "p_amount": 200000,
  "p_target_account_number": null,
  "p_source_app": "sd_link",
  "p_description": "Purchase",
  "p_metadata": {}
}
```

### 5.4 `transfer`

Request:

```json
{
  "p_device_id": "<device uuid>",
  "p_event_id": "<new uuid>",
  "p_event_type": "transfer",
  "p_amount": 50000,
  "p_target_account_number": "608-2026-0002",
  "p_source_app": "sd_link",
  "p_description": "Transfer",
  "p_metadata": {}
}
```

Rules:

- `p_target_account_number` is required only for `transfer`.
- Self-transfer is rejected.
- Both wallet balance updates and both ledger entries are in one database transaction.
- Wallets are locked in deterministic order to reduce transfer deadlock risk.

## 6. Mutation response

First successful application example:

```json
{
  "ok": true,
  "duplicate": false,
  "event_id": "4a9d913f-9cb0-43f3-8630-14b1425894c8",
  "type": "reward",
  "amount": 100000,
  "transaction_id": "65f8bb4c-0d8e-434e-9d74-69c11c72dd94",
  "counterparty_transaction_id": null,
  "balance_before": 1000000,
  "balance_after": 1100000,
  "current_balance": 1100000,
  "server_time": "2026-08-20T00:00:00+00:00"
}
```

Meaning of balance fields:

- `balance_before`: balance immediately before this event was first applied.
- `balance_after`: balance immediately after this event was first applied.
- `current_balance`: current server balance at response time.

For a first-time request, `balance_after` and `current_balance` are normally equal.

## 7. `event_id` and idempotency

`p_event_id` is the idempotency key for the logical wallet event.

Rules:

1. Generate one UUID per logical event.
2. Keep the same `event_id` when retrying because of timeout, app restart, network loss, or unknown response status.
3. Do not generate a new `event_id` just because the same HTTP request is being retried.
4. A matching replay is not applied again.
5. A reused `event_id` with changed semantic payload is rejected as an idempotency conflict.

Payload fields participating in conflict detection include:

- authenticated user
- `device_id`
- event type
- amount
- resolved transfer target
- source app
- description
- metadata

Exact replay response example after other transactions have already occurred:

```json
{
  "ok": true,
  "duplicate": true,
  "event_id": "4a9d913f-9cb0-43f3-8630-14b1425894c8",
  "type": "reward",
  "amount": 100000,
  "balance_before": 1000000,
  "balance_after": 1100000,
  "current_balance": 900000
}
```

This means the original event was applied once at 1,000,000 → 1,100,000, but the wallet is now 900,000 after later events. SD Link must use `current_balance` or call `sd_core_get_snapshot` before updating its displayed authoritative balance.

## 8. Atomicity and ledger guarantees

`sd_core_apply_wallet_event` is a single PostgreSQL transaction.

For `reward`/`spend`:

- wallet row lock
- balance validation/calculation
- wallet balance update
- transaction ledger insert
- event journal completion

For `transfer`:

- both wallets are locked
- sender/receiver balances are validated/calculated
- both balances are updated
- two ledger rows are inserted
- one event journal row links the pair

If any step fails, the whole RPC transaction is rolled back. A wallet balance change cannot commit without its corresponding ledger/event journal records.

## 9. Direct DB writes are forbidden

Authenticated/anonymous clients must not receive INSERT/UPDATE/DELETE access to:

- `public.wallets`
- `public.transactions`
- `public.sd_core_wallet_events`

Clients may read their own rows according to RLS, but wallet mutations must go through Core RPCs.

Do not implement any SD Link code that does:

```text
UPDATE wallets SET balance = <locally calculated balance>
```

or equivalent upsert/overwrite behavior.

## 10. RLS and function permissions

`sd_core_wallet_events` has RLS enabled.

Authenticated users may select only rows where:

```text
auth.uid() = user_id
```

The Core mutation functions are `SECURITY DEFINER` because they must update server-owned rows that clients cannot update directly. Each Core function:

- uses an empty `search_path`
- references application tables with explicit schema names
- validates `auth.uid()` internally
- verifies device ownership/state
- revokes execution from `PUBLIC` and `anon`
- grants execution only to `authenticated`

## 11. Error codes

Supabase/PostgREST returns PostgreSQL SQLSTATE in the response `code` field for Core-defined errors.

| SQLSTATE | Message | Meaning |
|---|---|---|
| `P1001` | `AUTH_REQUIRED` | no authenticated user |
| `P1002` | `ACCOUNT_INACTIVE` | account is not active |
| `P1003` | `DEVICE_NOT_FOUND` | device_id not owned/found |
| `P1004` | `DEVICE_INACTIVE` | device link is paused/inactive |
| `P1006` | `DEVICE_REVOKED` | device was revoked |
| `P1007` | `EVENT_ID_REQUIRED` | missing event id |
| `P1010` | `INVALID_EVENT_TYPE` | not reward/spend/transfer |
| `P1011` | `INVALID_AMOUNT` | amount must be positive and within limit |
| `P1012` | `INVALID_TARGET` / `TARGET_NOT_ALLOWED` | transfer target rules violated |
| `P1013` | `INSUFFICIENT_FUNDS` | spend/transfer would go below zero |
| `P1014` | `BALANCE_LIMIT_EXCEEDED` | resulting balance exceeds server limit |
| `P1015` | `IDEMPOTENCY_CONFLICT` | same event_id reused with different payload |
| `P1016` | `WALLET_NOT_FOUND` | authenticated account has no wallet |
| `P1017` | `TARGET_NOT_FOUND` | transfer target account does not exist |
| `P1018` | `SELF_TRANSFER_NOT_ALLOWED` | sender and recipient are the same user |
| `P1019` | `INVALID_DEVICE_KEY` | device key is not 64 lowercase hex after normalization |
| `P1020` | `INVALID_DEVICE_NAME` | device name too short |
| `P1021` | `INVALID_PLATFORM` | platform unsupported |
| `P1022` | `INVALID_SOURCE_APP` | source app missing/too long |
| `P1023` | `METADATA_TOO_LARGE` | metadata exceeds 16 KiB |
| `P1024` | `TARGET_ACCOUNT_INACTIVE` | target account is inactive |
| `P1025` | `EVENT_NOT_COMPLETED` | existing event is not in completed state |
| `P1026` | `INVALID_METADATA` | metadata must be a JSON object |

Standard PostgreSQL/Data API errors may also occur before the function body runs, for example `22P02` when a UUID argument is malformed.

Client retry guidance:

- Retry network errors/timeouts with the **same** `event_id`.
- Treat `P1015` as a client logic/data-integrity error; do not auto-generate a replacement ID and retry silently.
- Treat `P1013` and validation codes as final unless user/game state changes.
- After an unknown outcome, retry with the same `event_id`, then use `current_balance`/snapshot.

## 12. Legacy SD Link compatibility

The following compatibility rule is mandatory during migration:

- Do not remove or rename current legacy RPCs.
- Do not silently change legacy parameter meaning from signed amount to semantic positive amount.
- New SD Link code must opt into `sd_core_*` APIs explicitly.
- Old SD Link clients may continue using the legacy protocol until a separate client migration is approved.

Known legacy mismatch:

- Legacy `push_sd_link_transaction` currently accepts `deposit`/`withdraw` plus a signed amount.
- SD Core v1 intentionally does **not** copy that behavior.
- The SD Link integration branch should translate local intent into `reward`/`spend`/`transfer` with positive `p_amount` and a stable `event_id`.

No legacy protocol change is authorized by this document alone.

## 13. Required regression scenario

The integration is not considered verified unless this exact sequence passes:

```text
start balance                 1,000,000
reward 100,000                1,100,000
spend 200,000                   900,000
replay same reward event_id     900,000  (no second reward)
re-login / re-sync              900,000
PC unavailable; server read     900,000
```

The repository test `tests/sd-core/wallet_regression.sql` encodes this scenario and also checks event conflict handling and direct balance-write denial.

## 14. Future extension points

The v1 identity/idempotency model is intended to be reused, not duplicated, when Core expands to:

- common inventory and item IDs
- achievement event ingestion/progress
- seasons and season rewards
- shared expansion state

Future modules should prefer semantic commands/events and server-owned state transitions rather than accepting final client-calculated state blobs where authoritative server calculation is practical.
