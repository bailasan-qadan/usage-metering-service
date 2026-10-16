# Usage Metering Service

## Tables

| Table | Purpose | Key columns |
|---|---|---|
| plans | Account plans and user plans | id, kind (account/user), name, monthly_allowance, max_per_request, owner_account_id (NULL = predefined) |
| accounts | Calling companies | id, name, plan_id |
| api_keys | One key per account | id, account_id, key_hash, created_at |
| users | Users of an account | id, account_id, external_id, plan_id |
| account_usage | Units used per account per month | account_id, month, units_used |
| user_usage | Units used per user per month | user_id, month, units_used |
| consumption_requests | History of every decision | id, account_id, user_id, request_id, units, month, accepted, rejected_level, rejected_rule, created_at |

## Design decisions

- One plans table for both kinds, separated by a kind column.
- owner_account_id is NULL for predefined plans, which makes them read-only.
- Plans are referenced by id, so updates apply immediately with no redeploy.
- Usage is stored per month in counter tables, so a new month starts at zero and old months stay queryable.
- Only a hash of the API key is stored; the real key is shown once.
- users.external_id is unique per account.

## Business rules

1. Both plans must pass. If several rules fail, report one: per-request limit before monthly allowance, user before account.
2. Months are UTC, stored as the first day of the month.
3. Remaining = max(0, allowance - used). Requests at that level are rejected.
4. (account_id, request_id) is unique. Same request_id with the same data returns the original decision. Different data returns 409 Conflict.
5. Rejections are recorded in history and consume nothing.
6. New accounts default to Starter, new users to Basic.

## Predefined plans

| Plan | Kind | Monthly allowance | Max per request |
|---|---|---|---|
| Starter | account | 10,000 | 100 |
| Pro | account | 100,000 | 1,000 |
| Basic | user | 1,000 | 20 |
| Premium | user | 5,000 | 100 |

They are created automatically at startup and are read-only.

## API keys

- `POST /accounts` with `{ "name": "..." }` creates an account on the Starter plan and returns its API key once. Only a SHA-256 hash is stored, so a lost key cannot be recovered.
- Send the key in the `X-API-Key` header on every other request. A missing or invalid key returns `401`.
- Assumption: creating an account needs no key, because the key does not exist yet. Role management is out of scope, so anyone who can reach the service can create an account.

## Users and plan assignment

- All user routes need the `X-API-Key` header. A user is identified by the caller's own `userId`, which is unique within an account. The same `userId` may exist in different accounts.
- `POST /users` with `{ "userId": "...", "planId": "..." }` registers a user. `planId` is optional and defaults to Basic. Registering an existing `userId` returns `409`.
- `GET /users/:userId` shows the user and the plan currently applied.
- `PUT /users/:userId/plan` with `{ "planId": "..." }` changes the user's plan.
- `GET /account` shows the account's plan. `PUT /account/plan` with `{ "planId": "..." }` changes it.
- A user belonging to another account returns `404`, the same as a user that does not exist.
- A plan can be assigned if it is predefined or owned by the caller's account. An unknown or inaccessible plan returns `404`, and a plan of the wrong kind (an account plan for a user, or the reverse) returns `400`.
- Changing a plan keeps the units already consumed. It does not grant a fresh allowance.

## Custom plans

- All plan routes need the `X-API-Key` header. An account sees the predefined plans plus its own custom plans.
- `GET /plans` lists them (optional filter `?kind=account` or `?kind=user`). `GET /plans/:planId` shows one.
- `POST /plans` with `{ "kind", "name", "monthlyAllowance", "maxPerRequest" }` creates a custom plan owned by the caller's account. `kind` is `account` or `user`.
- `PATCH /plans/:planId` changes any of `name`, `monthlyAllowance` and `maxPerRequest`. A plan's `kind` cannot be changed.
- Predefined plans are read-only (`403`). A plan owned by another account behaves as if it does not exist (`404`).
- Assignments store a plan id, and decisions read the plan from the database on every request. So an update applies immediately to every account or user using that plan, and several users can share one plan while keeping separate usage totals.
- Assumptions: `monthlyAllowance` is a whole number from 0 up, `maxPerRequest` a whole number from 1 up to 2,147,483,647, and plan names need not be unique.
- Known limitation: plans cannot be deleted, because they may be assigned or referenced by request history.
