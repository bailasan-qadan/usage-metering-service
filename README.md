# Usage Metering Service

A backend service that other applications call to track usage and decide whether their users may perform an action. An application's backend asks the service to consume units for a user. The service checks the account's plan and the user's plan together, records the decision, and counts the usage only if the request is accepted.

Built with TypeScript (strict), Express, PostgreSQL and Drizzle ORM: one service and one database, plus an example client. Docker Compose starts everything.

## Contents

- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Accounts, users and plans](#accounts-users-and-plans)
- [Getting and using an API key](#getting-and-using-an-api-key)
- [API reference](#api-reference)
- [Rules and decisions](#rules-and-decisions)
- [Plan changes](#plan-changes)
- [Retry behavior](#retry-behavior)
- [Months, usage and history](#months-usage-and-history)
- [Product assumptions](#product-assumptions)
- [Database design](#database-design)
- [Main design decisions](#main-design-decisions)
- [Known limitations](#known-limitations)
- [Example client](#example-client)
- [Automated tests](#automated-tests)
- [Performance testing](#performance-testing)
- [Project structure](#project-structure)

## Quick start

Requirement: Docker with Compose v2.

```bash
docker compose up --build
```

This builds and starts PostgreSQL, the metering service and the example client. On startup the service applies its database migrations and creates the predefined plans by itself, and the client prepares a demo account. No setup is needed.

- Example client (demo web page): http://localhost:4000
- Metering service API: http://localhost:3000
- PostgreSQL from your machine: `localhost:5433`

Data lives in a Docker volume and survives restarts. `docker compose down` stops the stack and keeps the data. `docker compose down -v` also deletes the data.

### Running the service without Docker

Requirements: Node.js 20.6 or newer (developed on 22) and Docker for the database.

```bash
cp .env.example .env        # first, so the database is created with these credentials
docker compose up -d db
npm install
npm run dev
```

| Command | Purpose |
|---|---|
| `npm run dev` | Start the service with automatic reload |
| `npm run build` / `npm start` | Compile to `dist/` and run the compiled service |
| `npm run lint` | Check the code and forbid the `any` type |
| `npm test` | Run the automated tests |
| `npm run loadtest` | Run the load tests (the stack must be running) |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |

## Configuration

Everything is optional. Docker Compose has local-demo defaults. Set values in a `.env` file next to `docker-compose.yml` (`.env.example` shows the names). Use letters and digits only in the password, because it is placed in a URL, and change the default for anything beyond a local demo.

| Variable | Default | Purpose |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `metering` | Database credentials |
| `SERVICE_PORT`, `CLIENT_PORT`, `DB_PORT` | `3000`, `4000`, `5433` | Host ports used by Docker Compose |
| `DATABASE_URL` | none | Only when the service runs outside Docker (see `.env.example`) |
| `PORT` | `3000` | Port of the service |
| `METERING_URL` | `http://localhost:3000` | Service address, for the client and the load test |
| `METERING_API_KEY` | none | Client only: reuse an existing account instead of creating a demo one |
| `LOADTEST_SCALE` | `1` | Load test only: multiplies the number of requests |

## Accounts, users and plans

- An **account** is a calling application. It has an **account plan** and a shared monthly allowance.
- A **user** belongs to exactly one account and has a **user plan** and an individual allowance. Users are identified by the calling application's own user id.
- Both plans apply together. A larger user allowance never increases the account's shared allowance, and the account's usage is the sum of its users' accepted usage.
- Several users can share one plan definition. They share the limits, never the usage.
- A **plan** has a `kind` (`account` or `user`) and two rules: a monthly allowance and a maximum number of units per request.

Predefined plans, created at startup and read-only:

| Plan | Kind | Monthly allowance | Max per request |
|---|---|---|---|
| Starter | account | 10,000 | 100 |
| Pro | account | 100,000 | 1,000 |
| Basic | user | 1,000 | 20 |
| Premium | user | 5,000 | 100 |

Accounts can also create their own plans (see [Plan changes](#plan-changes)).

## Getting and using an API key

Creating an account needs no key. It returns the account's API key **once**:

```bash
curl -s -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" -d '{"name": "Acme"}'
```

Send the key in the `X-API-Key` header on every other request:

```bash
curl -s http://localhost:3000/account -H "X-API-Key: mk_..."
```

The key identifies the calling account and gives access only to that account's data. A missing or invalid key returns `401`. Only a SHA-256 hash of the key is stored, so a lost key cannot be recovered.

## API reference

All requests and responses are JSON. Every endpoint except `POST /accounts` needs the `X-API-Key` header.

| Method and path | Purpose |
|---|---|
| `POST /accounts` | Create an account on Starter and receive its API key |
| `GET /account` | Show the account and its current plan |
| `PUT /account/plan` | Change the account's plan |
| `POST /users` | Register a user (optional plan, default Basic) |
| `GET /users/:userId` | Show a user and the plan applied |
| `PUT /users/:userId/plan` | Change a user's plan |
| `GET /users/:userId/usage` | One user's usage (`?month=`) |
| `GET /plans` | List predefined plans and the account's own (`?kind=`) |
| `GET /plans/:planId` | Show one plan |
| `POST /plans` | Create a custom plan |
| `PATCH /plans/:planId` | Change a custom plan |
| `POST /consume` | Ask to consume units |
| `GET /usage` | Account usage and a page of its users (`?month=&limit=&offset=`) |
| `GET /requests` | Request history, newest first (`?month=&userId=&limit=&offset=`) |

### Request and response formats

- `POST /accounts`: `{ "name": "Acme" }` returns `201` with `{ "account": { "id", "name", "createdAt", "plan" }, "apiKey": "mk_..." }`.
- `POST /users`: `{ "userId": "alice", "planId": "<optional uuid>" }` returns `201` with `{ "user": { "userId", "createdAt", "plan" } }`.
- `PUT /account/plan` and `PUT /users/:userId/plan`: `{ "planId": "<uuid>" }`.
- `POST /plans`: `{ "kind": "user", "name": "Team", "monthlyAllowance": 300, "maxPerRequest": 30 }` returns `201` with `{ "plan": { "id", "kind", "name", "monthlyAllowance", "maxPerRequest", "predefined" } }`.
- `PATCH /plans/:planId`: any of `name`, `monthlyAllowance`, `maxPerRequest`.
- `POST /consume`: `{ "userId": "alice", "units": 25, "requestId": "doc-1042" }`. The response is the decision:

```json
{
  "accepted": false,
  "requestId": "doc-1042",
  "userId": "alice",
  "units": 25,
  "month": "2026-10",
  "replayed": false,
  "rejection": {
    "level": "user",
    "rule": "max_per_request",
    "message": "The request is larger than the user's maximum units per request"
  },
  "account": { "plan": "Starter", "monthlyAllowance": 10000, "maxPerRequest": 100, "used": 0, "remaining": 10000 },
  "user": { "plan": "Basic", "monthlyAllowance": 1000, "maxPerRequest": 20, "used": 0, "remaining": 1000 }
}
```

- `GET /usage`: `{ "month", "account": { plan, limits, used, remaining }, "users": [ ... ], "pagination": { limit, offset, total } }`.
- `GET /requests`: `{ "requests": [ { requestId, userId, units, month, accepted, rejection, createdAt } ], "pagination": { limit, offset, total } }`.

### Errors

Errors always look like `{ "error": { "code": "...", "message": "..." } }`.

| Status | Meaning | Example codes |
|---|---|---|
| 400 | Invalid input | `invalid_json`, `invalid_body`, `invalid_units`, `invalid_request_id`, `invalid_user_id`, `invalid_plan_id`, `invalid_kind`, `invalid_plan_name`, `invalid_monthly_allowance`, `invalid_max_per_request`, `invalid_month`, `month_in_future`, `invalid_limit`, `invalid_offset`, `wrong_plan_kind`, `kind_not_updatable`, `no_changes` |
| 401 | Missing or invalid key | `missing_api_key`, `invalid_api_key` |
| 403 | Predefined plans are read-only | `predefined_plan_read_only` |
| 404 | Not found, including other accounts' data | `user_not_found`, `plan_not_found` |
| 409 | Conflict | `user_already_exists`, `request_id_conflict` |
| 500 | Unexpected error (details are only logged) | `internal_error` |

## Rules and decisions

Two rule types exist, for both account plans and user plans:

- **Monthly allowance:** the total units available during a UTC calendar month.
- **Maximum units per request:** the largest amount one request may consume.

Every request must satisfy both plans, and it is accepted in full or not at all. A rejection consumes nothing. For example, with an account on 10,000 a month and 100 per request, and a user on 1,000 a month and 20 per request:

- A request for 25 units is rejected by the user's per-request limit, even if both monthly allowances have room.
- A request for 10 units is accepted if both have room, and adds 10 to the user's usage and 10 to the account's shared usage.
- If the account has only 5 units left, a 10-unit request is rejected even if the user has plenty.

If several rules fail, the response names one, in this order: per-request limits before monthly allowances, and the user before the account. The rejection says whether the rule belongs to the `user` or the `account`. `GET /account` and `GET /users/:userId` show the plans and limits currently applied, and every consume response shows the plan, limits, used and remaining units of both levels.

A rejected request still returns HTTP `200` with `accepted: false`, because it is a valid decision and not an error. HTTP errors mean the request could not be processed.

## Plan changes

- Accounts create, view and update their own plans (`POST /plans`, `GET /plans`, `PATCH /plans/:planId`) and assign them to the account (`PUT /account/plan`) or to users (`PUT /users/:userId/plan`).
- Predefined plans are read-only (`403`). A plan owned by another account behaves as if it does not exist (`404`). A plan's kind cannot be changed, and plans cannot be deleted.
- Accounts and users store a plan id, and decisions read the plan from the database for every request. An update therefore applies to every request that starts after it commits, for every account or user using that plan, with no redeploy.
- Switching plans keeps the units already consumed. It does not grant a fresh allowance.
- If a monthly allowance is lowered below existing usage, `remaining` shows 0 and further requests are rejected at that level until the allowance is raised or the month ends.
- Changes never rewrite the request history.

## Retry behavior

`requestId` is chosen by the caller and is unique per account.

- Repeating a request with the same user and units returns the original decision with `replayed: true` and counts nothing again.
- A rejected request is replayed as rejected. To try again, use a new `requestId`.
- Reusing a `requestId` with a different user or number of units returns `409 request_id_conflict`.
- On a replay, `month` is the month of the original request, and the `account` and `user` figures show that month's balances as they are now.
- Retries that arrive at the same moment are safe: the account is locked while a request is processed, so exactly one of them is the first-time answer.

## Months, usage and history

- Months are UTC calendar months, written `YYYY-MM`. New usage belongs to the month in which the request is processed, and each new month starts at zero for the account and every user. Earlier months stay available.
- `GET /usage` and `GET /users/:userId/usage` take `?month=`. For earlier months `remaining` is `null`, because the plan shown is always the one applied now and old limits are not stored. A future month returns `400`.
- `GET /requests` lists every decision, accepted or rejected, newest first, with optional `month` and `userId` filters.
- Pagination uses `limit` (1 to 100, default 20) and `offset`, and the response includes `pagination.total`.
- Each response is read from one consistent database snapshot, so the account total and its users' figures agree.

## Product assumptions

The brief leaves these open. They are applied consistently across the service.

1. Creating an account needs no key, because the key does not exist yet. Roles are out of scope, so anyone who can reach the service can create an account.
2. A new account starts on Starter and a new user on Basic.
3. Users are identified by the caller's own user id (1 to 200 characters), unique within an account. The same id may exist in different accounts.
4. A plan can be assigned only if its kind matches (account plan to an account, user plan to a user) and it is predefined or owned by the caller. Otherwise: `400` for the wrong kind, `404` for an unknown or foreign plan.
5. Another account's user or plan answers `404`, the same as one that does not exist, so nothing about other accounts is revealed.
6. Units are a positive whole JSON number up to 2,147,483,647. A monthly allowance is a whole number from 0, and a maximum per request a whole number from 1. A plan with allowance 0 rejects everything.
7. Plan names need not be unique.
8. When several rules fail, one is reported, in a fixed order (see [Rules and decisions](#rules-and-decisions)). A request that is too large for a per-request limit can never succeed at that size, so that is the more useful reason.
9. Rejections are HTTP `200` decisions. The history records every decision, including rejections.
10. A request id is final: a rejected request stays rejected when it is repeated.
11. Past months show used units but no remaining figure.
12. One API key is issued per account, once.

## Database design

One PostgreSQL database with seven tables. The schema is in `src/db/schema.ts` and the migrations are in `drizzle/`.

| Table | Purpose | Key columns and rules |
|---|---|---|
| `plans` | Plan definitions | `kind` (`account` or `user`), `monthly_allowance` (at least 0), `max_per_request` (above 0), `owner_account_id` (empty for predefined, read-only plans) |
| `accounts` | Calling applications | `plan_id` points to `plans` |
| `api_keys` | Authentication | `account_id` points to `accounts`, `key_hash` is unique. Only the SHA-256 hash is stored, never the key |
| `users` | The application's users | `account_id`, `external_id` (the application's own id), `plan_id`. Unique on `(account_id, external_id)` |
| `account_usage` | Units used by an account per month | Primary key `(account_id, month)`, `units_used` never below 0 |
| `user_usage` | Units used by a user per month | Primary key `(user_id, month)`, `units_used` never below 0 |
| `consumption_requests` | History and retry record | Unique on `(account_id, request_id)`, index on `(account_id, created_at)`, stores `units`, `month`, `accepted` and the rejection level and rule |

How they relate:

- An account has one plan and many users and API keys. A user has one plan. Several accounts or users can point to the same plan.
- Usage is one row per account or user per month, created when the first request of that month is processed.
- Every consumed request is recorded in `consumption_requests` with its decision, so history never changes when a plan changes later.

Rules enforced by the database itself, not only by the code:

- Allowances and usage can never be negative, and `max_per_request` and `units` must be above 0.
- An accepted request has no rejection details, and a rejected request always has a level (`account` or `user`) and a rule (`monthly_allowance` or `max_per_request`).
- The same `requestId` cannot be recorded twice for one account, which makes retries safe even when they arrive at the same moment.

## Main design decisions

- **Plans are referenced by id.** Editing a plan changes behavior immediately, with nothing to redeploy.
- **Usage is stored per month**, one row per account or user per month. A new month needs no reset job, and old months stay queryable.
- **One transaction per consume request.** It locks the account's usage row for the month, then the user's, always in that order. Requests of one account run one after another, so two requests can never both spend the last units, while different accounts run in parallel. The decision, the counter updates and the history record commit together or not at all.
- **The rules are a pure function** (`decide()`), tested without a database.
- **Retries rely on the database:** a unique `(account_id, request_id)` constraint plus the stored decision.
- **API keys are random and stored as SHA-256 hashes.** A fast hash is enough for long random keys, unlike passwords.
- **Startup does the setup:** the service applies the migrations, then creates the predefined plans (safe to repeat), then starts listening.
- **Typed boundaries:** everything from outside (request bodies, JSON responses, errors) is typed `unknown` and checked before use. The `any` type is forbidden by the lint rules.
- **Layers:** routes (HTTP) call validation and then services (logic and SQL). Routes contain no business logic.
- **Tests use a real PostgreSQL**, because locks, transactions and constraints only exist there.

## Known limitations

- No key rotation or revocation, and no plan deletion.
- Anyone who can reach the service can create an account (no roles, by scope).
- Offset pagination can shift if new requests arrive while a client is paging through history.
- Past months do not show remaining units, because old plan limits are not stored.
- Requests of one account run one after another. That is the price of exact totals, and it limits per-account throughput (see [Performance testing](#performance-testing)).
- Single database instance. There is no distributed infrastructure.
- Measured throughput is modest on a laptop where the load generator, service and database share one machine.

## Example client

`client/` is a small, separate application that pretends to be a document processing service. It calls the metering service only through its HTTP API, like any other calling application. The API key stays in the client's backend and is never sent to the browser.

On startup it waits for the service, creates a demo account on a custom company plan (100 units a month, 50 per request), and registers two users: `alice` (Basic) and `bob` (Premium). Each page costs one unit. Open http://localhost:4000 (Docker Compose starts it for you). To run it on its own: `cd client`, `npm install`, `npm run dev`.

Demonstration, on a fresh start:

1. alice, 10 pages: accepted.
2. alice, 25 pages: rejected by the user's maximum per request (Basic allows 20).
3. bob, 50 pages: accepted.
4. bob, 45 pages: rejected by the account's monthly allowance, although bob has plenty left.
5. Set the company allowance to 1000, then bob, 45 pages: accepted.
6. Switch alice to Premium, then alice, 25 pages: accepted.
7. Set the company allowance to 50: remaining shows 0 and requests are rejected at the account level.

The client's request code is identical in every step. Only the plan configuration in the service changes the outcome.

## Automated tests

Run them with `npm test` while the database is up (`docker compose up -d db`). They use Node's built-in test runner, so there are no extra dependencies.

They run against the real PostgreSQL, in a separate database named after yours with `_test` appended (for example `metering_test`). It is created automatically, and its tables and predefined plans are set up the same way as at service startup. Your development data is never touched. To reset it, drop that database. Every test creates its own accounts, so tests do not depend on each other or on earlier runs.

There are 105 tests. They cover API key validation on every protected route, account isolation, predefined and custom plans, plan changes, every consume rule and rejection reason, retries and conflicts, UTC month boundaries (with a controlled clock), usage and history with pagination, and concurrent requests.

## Performance testing

### How it was tested

`npm run loadtest` is a custom TypeScript tool (`src/loadtest/`) with no extra dependencies. It talks to a running service through the public API and, after each scenario, checks the stored totals against what the responses said, so it tests correctness and speed together.

To reproduce: Docker and Node.js 20.6 or newer, then:

```bash
npm install
docker compose up -d --build
npm run loadtest        # LOADTEST_SCALE=0.2 for a quick, smaller run
```

The report is written to `loadtest/results.md`. The tool exits with an error if any check fails.

| Scenario | What it tests |
|---|---|
| Independent accounts | Throughput when requests do not compete |
| One hot account | The cost of the per-account lock |
| Shared allowance | Demand above the allowance: exactly the allowed units may be accepted |
| Retries under load | The same request id arriving three times at once |
| Plan changes during load | The allowance changes every 25 ms while requests arrive, then is lowered below usage |

### Results

Run on a laptop (AMD Ryzen 5 3500U, 8 logical CPUs, 6.7 GB RAM, Docker on WSL2) with the load generator, service and database all on the same machine, on 2026-10-17. All correctness checks passed in every scenario.

| Scenario | Requests | Concurrency | Requests/s | p50 ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|---|---|
| Independent accounts | 4000 | 40 | 82 | 472 | 601 | 690 | 870 |
| One hot account | 4000 | 40 | 33 | 1016 | 2267 | 3152 | 4971 |
| Shared allowance | 1000 | 100 | 37 | 2573 | 3574 | 4546 | 5751 |
| Retries under load | 900 | 100 | 47 | 1997 | 2639 | 3258 | 4568 |
| Plan changes during load | 3000 | 50 | 34 | 1322 | 2401 | 3340 | 4568 |

The full report with every check is in [`loadtest/results.md`](loadtest/results.md).

### What we learned

- **Correctness held under every kind of pressure.** With up to 100 concurrent clients there was no overspending, retries were counted once, every request was recorded exactly once, and stored totals matched the accepted units even while the allowance changed every 25 ms.
- **Requests of one account queue by design.** One hot account reached 33 requests per second against 82 for independent accounts, because the shared counter is locked while a request is decided. That is the price of exact totals, and different accounts do not slow each other.
- **Latency is mostly waiting, not working.** Latency is roughly concurrency divided by throughput (40 / 33 is about 1.2 s, 100 / 37 is about 2.7 s), so adding clients to a saturated account only lengthens the queue.
- **The numbers are a conservative baseline.** They come from one laptop that also runs the load generator and Docker, and should not be read as capacity.
- **The next improvement is clear.** A consume request makes about 11 sequential database round trips and a durable commit, all while holding the account lock. Reading the user and both plans in one query would shorten the locked part and raise per-account throughput. Durability was not weakened to gain speed. Each change should be measured again with this tool.

## Project structure

```
.
├── Dockerfile                  service image (build stage, then a small runtime stage)
├── docker-compose.yml          database, service and client
├── .env.example                configuration template
├── drizzle/                    SQL migrations, applied at startup
├── loadtest/results.md         load test report (generated)
├── src/
│   ├── index.ts                startup: migrate, create predefined plans, listen
│   ├── app.ts                  Express wiring
│   ├── config.ts, errors.ts, months.ts, validation.ts
│   ├── auth/apiKeys.ts         key generation and hashing
│   ├── db/                     connection, schema, migrations runner, predefined plans
│   ├── middleware/             API key check, error handler
│   ├── routes/                 accounts, users, plans, consume, usage, requests
│   ├── services/               business logic and SQL (decision.ts holds the rules)
│   ├── types/express.d.ts      adds the account id to the request type
│   ├── tests/                  automated tests and their runner
│   └── loadtest/               load test tool
└── client/                     example application (own Dockerfile)
    ├── public/index.html       the demo web page
    └── src/                    small backend that holds the API key
```
