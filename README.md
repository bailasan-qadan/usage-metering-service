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

## Consuming units

- `POST /consume` with `{ "userId", "units", "requestId" }` and the `X-API-Key` header. `units` must be a positive whole JSON number (up to 2,147,483,647). `requestId` is chosen by the caller (1 to 200 characters).
- A request is accepted only if both the user's plan and the account's plan allow it. A rejection consumes nothing.
- The response is `200` for both outcomes, because a rejection is a valid decision and not an error. It contains `accepted`, `rejection` (`level` is `user` or `account`, `rule` is `max_per_request` or `monthly_allowance`, plus a `message`), and the plan, limits, `used` and `remaining` for the account and the user.
- If several rules fail, one is reported in this order: maximum per request before monthly allowance, and the user before the account.
- Months are UTC calendar months. Usage belongs to the month in which the request is processed, and a new month starts at zero.
- `remaining` is never negative. If an allowance is lowered below existing usage, `remaining` shows 0 and requests at that level are rejected until the allowance is raised or the month ends.
- Retries: `requestId` is unique per account. Repeating a request with the same user and units returns the original decision with `replayed: true` and counts nothing again. A rejected request is replayed as rejected, so use a new `requestId` to try again. Reusing a `requestId` with a different user or number of units returns `409`. On a replay, `account` and `user` show the current balances.
- Concurrency: each request runs in one database transaction. It first locks the account's usage row for the month, then the user's, always in that order. Requests of the same account therefore run one after another, while different accounts run in parallel. The decision, the counter updates and the history record commit together or not at all.
- Plans are read inside that transaction, so an edit applies to every request that starts after the edit commits.

## Usage and history

- Months are written `YYYY-MM` (UTC) in requests and responses. Months before the current one can be queried back to 2000-01. A future month returns `400`.
- `GET /usage?month=` returns the account's usage and a page of its users (`limit` and `offset`, ordered by `userId`). `month` defaults to the current month. Each entry shows `used`, `remaining`, and the plan and limits currently applied. A user with no usage in that month shows `used: 0`.
- `GET /users/:userId/usage?month=` returns the same figures for one user.
- `remaining` is only calculated for the current month. For earlier months it is `null`, because the plan shown is always the one applied now and old limits are not stored.
- `GET /requests` lists request outcomes, newest first. Optional filters: `month` and `userId`. Each record has `requestId`, `userId`, `units`, `month`, `accepted`, `rejection` (`level`, `rule`, `message`) and `createdAt`. History is never rewritten by plan changes.
- Pagination: `limit` (1 to 100, default 20) and `offset` (default 0). The response includes `pagination.total`.
- Each response is read from one consistent database snapshot, so account totals and user figures agree.
- Known limitation: offset pagination can shift if new requests arrive while a client is paging through history.

## Automated tests

- Run them with `npm test` while the database is up (`docker compose up -d db`). They use Node's built-in test runner, so there are no extra dependencies.
- They run against the real PostgreSQL, in a separate database named after yours with `_test` appended (for example `metering_test`). It is created automatically, and its tables and predefined plans are set up the same way as at service startup. Your development data is never touched. To reset it, drop that database.
- Every test creates its own accounts, so tests do not depend on each other or on earlier runs.
- Covered: API key validation on every protected route, account isolation, predefined and custom plans, plan changes, every consume rule and rejection reason, retries and conflicts, UTC month boundaries (with a controlled clock), usage and history with pagination, and concurrent requests.

## Example client

`client/` is a small, separate application that pretends to be a document processing service. It calls the metering service only through its HTTP API, like any other calling application. The API key stays in the client's backend and is never sent to the browser.

On startup it waits for the service, creates a demo account on a custom company plan (100 units a month, 50 per request), and registers two users: `alice` (Basic) and `bob` (Premium). Set `METERING_API_KEY` to reuse an existing account instead of creating one.

Configuration: `METERING_URL` (default `http://localhost:3000`), `METERING_API_KEY` (optional), `PORT` (default `4000`).

Run it locally with the service and database up: `cd client`, `npm install`, `npm run dev`, then open http://localhost:4000. Each page costs one unit.

Demonstration, on a fresh start:

1. alice, 10 pages: accepted.
2. alice, 25 pages: rejected by the user's maximum per request (Basic allows 20).
3. bob, 50 pages: accepted.
4. bob, 45 pages: rejected by the account's monthly allowance, although bob has plenty left.
5. Set the company allowance to 1000, then bob, 45 pages: accepted.
6. Switch alice to Premium, then alice, 25 pages: accepted.
7. Set the company allowance to 50: remaining shows 0 and requests are rejected at the account level.

The client's request code is identical in every step. Only the plan configuration in the service changes the outcome.

## Running with Docker Compose

```bash
docker compose up --build
```

This builds and starts the whole stack: PostgreSQL, the metering service and the example client. On startup the service creates its tables and the predefined plans by itself, and the client waits for the service and prepares its demo account. No setup is needed: the database credentials have local-demo defaults.

- Example client (the demo web page): http://localhost:4000
- Metering service API: http://localhost:3000
- PostgreSQL from your machine: port 5433

Configuration (all optional, set in a `.env` file next to `docker-compose.yml`; `.env.example` shows the names): `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (use letters and digits only, because they are placed in a URL), and the host ports `SERVICE_PORT`, `CLIENT_PORT` and `DB_PORT`. Change the default password for anything other than a local demo.

Data lives in a Docker volume and survives restarts. `docker compose down` stops the stack and keeps the data. `docker compose down -v` also deletes the data.

Without Docker for the service: start only the database with `docker compose up -d db`, copy `.env.example` to `.env`, then run `npm install` and `npm run dev`. The automated tests use the same database (`npm test`).
