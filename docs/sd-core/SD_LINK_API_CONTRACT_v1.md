# SD Link ↔ SD Core API Contract v1

Status: feature-branch contract for `feature/sd-core`.

This contract adds SD Core APIs without deleting, renaming, or changing the meaning of legacy SD Link RPCs such as `push_sd_link_transaction`, `register_sd_link_device`, `get_sd_link_snapshot`, and `pull_sd_link_transactions`.

## 1. Trust and state model

SD Core is the central online source of truth for account-bound wallet and ledger data.

- Supabase Auth JWT identifies the account.
- `device_id` binds a Core request to a registered device owned by that account.
- Wallet mutations use semantic event types, not signed client deltas.
- `event_id` is the global idempotency key for a logical wallet mutation.
- Clients never write the final wallet balance or transaction rows directly.
- Server state remains readable when the original PC/local database is unavailable.

Future inventory, achievements, and seasons should reuse the same account/device/event model rather than creating direct cross-extension DB access.

## 2. Authentication

All v1 APIs require a signed-in Supabase user session.

When using the Supabase Data API directly:

```http
Authorization: Bearer <user_access_token>
apikey: <publishable_or_legacy_anon_key>
Content-Type: application/json
```

Rules:

- Never ship `service_role` or another secret server key in SD Link, website JavaScript, desktop, or mobile clients.
- The server derives `user_id` from `auth.uid()`; mutation requests do not accept a caller-supplied `user_id`.
- A valid JWT alone is not enough for wallet mutation: the supplied `device_id` must also belong to the user and be active/not revoked.

## 3. Register device

RPC:

```text
POST /rest/v1/rpc/sd_core_register_device
```

Request:

```json
{
  "p_device_key": "<64 lowercase hex device key>",
  "p_device_name": "My Windows PC",
  "p_platform": "windows"
}
```

Allowed platforms: `windows`, `android`, `web`.

Response:

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

SD Link should persist the returned `device_id` for that account/device binding. A revoked device is not silently reactivated.

## 4. Get current server snapshot

RPC:

```text
POST /rest/v1/rpc/sd_core_get_snapshot
```

Request:

```json
{
  "p_device_id": "6e7464b2-1f2d-4e1e-8bd3-c31abf70b96a"
}
```

Response:

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

`balance` is authoritative server state. SD Link must not overwrite it afterward with a locally calculated final balance.

## 5. Apply wallet event

RPC:

```text
POST /rest/v1/rpc/sd_core_apply_wallet_event
```

Request:

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

### Transaction types and sign rule

`p_amount` is always a positive integer. The client never sends a negative amount to describe direction.

| `p_event_type` | Required amount | Server effect |
|---|---:|---:|
| `reward` | positive | wallet `+amount` |
| `spend` | positive | wallet `-amount` |
| `transfer` | positive | sender `-amount`, receiver `+amount` |

For `transfer`, `p_target_account_number` is required. For `reward` and `spend`, it must be null/empty. Self-transfer is rejected.

### First application response

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

For transfer, `counterparty_transaction_id` identifies the receiver-side ledger row.

## 6. `event_id` / duplicate request rules

`p_event_id` is the idempotency key for one logical wallet event.

1. Generate one UUID for the logical event.
2. If HTTP timeout/network loss/app restart leaves the outcome unknown, retry with the **same** `event_id`.
3. Do not create a new `event_id` merely because an HTTP call is retried.
4. Exact replay is returned as `duplicate: true` and is not applied again.
5. Reusing the same `event_id` with a changed semantic payload returns `IDEMPOTENCY_CONFLICT`.

Conflict comparison includes authenticated user, `device_id`, event type, amount, resolved transfer target, source app, description, and metadata.

Exact replay after later transactions can return:

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

`balance_before` / `balance_after` describe the original event application. `current_balance` is the server balance at replay response time. SD Link should use `current_balance`, or call `sd_core_get_snapshot`, for current displayed authority.

## 7. Read transaction ledger

RPC:

```text
POST /rest/v1/rpc/sd_core_list_transactions
```

Request:

```json
{
  "p_device_id": "6e7464b2-1f2d-4e1e-8bd3-c31abf70b96a",
  "p_after_seq": 14800,
  "p_limit": 100
}
```

Rules:

- `device_id` must belong to the authenticated account and be active/not revoked.
- `p_after_seq` is exclusive. Send `0` for the first page.
- Results are ascending by `sync_seq`.
- `p_limit` is clamped to `1..200` by the server.
- RLS remains in effect: a sender and receiver each see only their own ledger rows.

Response is an array of rows:

```json
[
  {
    "sync_seq": 14801,
    "transaction_id": "65f8bb4c-0d8e-434e-9d74-69c11c72dd94",
    "transaction_type": "sd_core_reward",
    "description": "Delivery reward",
    "amount": 100000,
    "balance_before": 1000000,
    "balance_after": 1100000,
    "platform": "windows",
    "metadata": {
      "sd_core_event_id": "4a9d913f-9cb0-43f3-8630-14b1425894c8"
    },
    "created_at": "2026-08-20T00:00:00+00:00"
  }
]
```

This is the new Core ledger API. Legacy `pull_sd_link_transactions` remains available for old clients and is not changed by v1.

## 8. Atomicity

`sd_core_apply_wallet_event` executes in one PostgreSQL transaction.

For `reward` / `spend`:

- lock wallet
- validate/calculates server delta
- update balance
- insert transaction ledger row
- mark `event_id` completed

For `transfer`:

- lock both wallets in deterministic order
- validate balances
- update sender and receiver
- insert sender and receiver ledger rows
- link both rows from the single event journal entry

Any error rolls the whole call back. A failed event must not leave a committed balance-only change, ledger-only change, or half-transfer.

## 9. Direct DB write prohibition

Clients must not receive direct INSERT/UPDATE/DELETE access to:

- `public.wallets`
- `public.transactions`
- `public.sd_core_wallet_events`

Do not implement SD Link code equivalent to:

```text
UPDATE wallets SET balance = <local_final_balance>
```

Wallet mutations must go through the Core event API.

## 10. RLS and privileged boundary

`public.sd_core_wallet_events` has RLS enabled and users may select only their own event rows.

The public `sd_core_*` endpoints are `SECURITY INVOKER` APIs. Privileged wallet/device mutation implementation lives in the non-exposed `sd_core_private` schema using `SECURITY DEFINER` functions with:

- empty `search_path`
- schema-qualified table access
- internal `auth.uid()` checks
- account/device state checks
- `PUBLIC` and `anon` execute revoked

`sd_core_private` must **not** be added to Supabase Data API exposed schemas. The public API is the supported client surface.

## 11. Error codes

Supabase/PostgREST exposes Core-defined PostgreSQL SQLSTATE values in the error `code` field.

| SQLSTATE | Message | Meaning |
|---|---|---|
| `P1001` | `AUTH_REQUIRED` | no authenticated user |
| `P1002` | `ACCOUNT_INACTIVE` | account inactive |
| `P1003` | `DEVICE_NOT_FOUND` | device missing or owned by another user |
| `P1004` | `DEVICE_INACTIVE` | device paused/inactive |
| `P1006` | `DEVICE_REVOKED` | revoked device |
| `P1007` | `EVENT_ID_REQUIRED` | missing event id |
| `P1010` | `INVALID_EVENT_TYPE` | not reward/spend/transfer |
| `P1011` | `INVALID_AMOUNT` | amount must be positive and within limit |
| `P1012` | `INVALID_TARGET` / `TARGET_NOT_ALLOWED` | target rule violation |
| `P1013` | `INSUFFICIENT_FUNDS` | spend/transfer would go below zero |
| `P1014` | `BALANCE_LIMIT_EXCEEDED` | resulting balance over server limit |
| `P1015` | `IDEMPOTENCY_CONFLICT` | same event id, different payload |
| `P1016` | `WALLET_NOT_FOUND` | account has no wallet |
| `P1017` | `TARGET_NOT_FOUND` | transfer target does not exist |
| `P1018` | `SELF_TRANSFER_NOT_ALLOWED` | sender equals receiver |
| `P1019` | `INVALID_DEVICE_KEY` | invalid 64-hex device key |
| `P1020` | `INVALID_DEVICE_NAME` | invalid device name |
| `P1021` | `INVALID_PLATFORM` | unsupported platform |
| `P1022` | `INVALID_SOURCE_APP` | invalid source app |
| `P1023` | `METADATA_TOO_LARGE` | metadata over 16 KiB |
| `P1024` | `TARGET_ACCOUNT_INACTIVE` | transfer target inactive |
| `P1025` | `EVENT_NOT_COMPLETED` | existing event not completed |
| `P1026` | `INVALID_METADATA` | metadata is not a JSON object |

Malformed typed arguments can also fail before the function body, e.g. PostgreSQL `22P02` for an invalid UUID string.

### Retry policy

- Network error / timeout / unknown response: retry the same request with the same `event_id`.
- `P1015`: client data-integrity bug; do not silently generate a new ID and retry.
- `P1013` and validation errors: do not retry until relevant user/game state changes.
- After any uncertain outcome, exact replay plus `current_balance`, or a fresh snapshot, resolves server truth.

## 12. Legacy compatibility

Mandatory migration rules:

- Do not remove or rename existing SD Link RPCs.
- Do not change legacy signed-amount parameter meaning in place.
- New SD Link code opts into `sd_core_*` APIs explicitly.
- Old clients may continue using the old protocol until a separate client migration is approved.

Known legacy mismatch: `push_sd_link_transaction` currently uses `deposit`/`withdraw` plus a signed amount. SD Core v1 intentionally uses semantic `reward`/`spend`/`transfer` with positive amounts. The SD Link integration side must translate its local intent when it explicitly adopts Core v1.

## 13. Required regression gate

The integration is not verified until this exact sequence passes:

```text
start balance                 1,000,000
reward 100,000                1,100,000
spend 200,000                   900,000
replay same reward event_id     900,000  (no second reward)
re-login / re-sync              900,000
PC unavailable; server read     900,000
```

Repository tests additionally verify transfer atomicity, sender/receiver RLS isolation, failed-transfer rollback, direct wallet/event-write denial, function privilege boundaries, and ledger pagination/device ownership.

## 14. Future Core modules

The following are extension points, not part of wallet v1 implementation yet:

- common inventory / item IDs
- achievement event ingestion and progress
- seasons / season rewards
- shared expansion state

They should reuse Core account/device/event identity and avoid extensions directly reading each other's local databases or installation folders.
