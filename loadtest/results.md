# Load test results

- Date: 2026-10-17T22:18:14.148Z
- Target: http://localhost:3000
- Node: v22.15.0
- Machine: 8 CPUs (AMD Ryzen 5 3500U with Radeon Vega Mobile Gfx), 6.7 GB RAM
- Scale: 1
- The load generator, the service and the database all ran on this same machine, so the load generator competes with them for CPU.

| Scenario | Requests | Concurrency | Seconds | Requests/s | p50 ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|---|---|---|
| Independent accounts | 4000 | 40 | 48.90 | 82 | 472.1 | 600.6 | 689.6 | 869.7 |
| One hot account | 4000 | 40 | 121.30 | 33 | 1015.6 | 2266.8 | 3151.8 | 4970.9 |
| Shared allowance | 1000 | 100 | 27.24 | 37 | 2573.4 | 3573.7 | 4546.0 | 5751.0 |
| Retries under load | 900 | 100 | 19.14 | 47 | 1996.7 | 2638.9 | 3257.5 | 4568.2 |
| Plan changes during load | 3000 | 50 | 87.08 | 34 | 1321.6 | 2400.8 | 3340.0 | 4568.4 |

## Independent accounts

40 accounts, 1 unit per request, spread evenly. No two requests compete for the same counters.

Outcomes: accepted 4000

- PASS: every response was HTTP 200 (0 other responses)
- PASS: every request was accepted (4000 of 4000)
- PASS: stored usage equals accepted units (stored 4000, accepted 4000)

## One hot account

All requests belong to one account (20 users), so they all compete for the same shared counter.

Outcomes: accepted 4000

- PASS: every response was HTTP 200 (0 other responses)
- PASS: every request was accepted (4000 of 4000)
- PASS: account usage equals accepted units (stored 4000, accepted 4000)
- PASS: users' usage adds up to the account's (users 4000, account 4000)

## Shared allowance

1000 requests of 10 units against an account allowance of 5000: demand exceeds the allowance.

Outcomes: accepted 500, rejected 500

- PASS: every response was HTTP 200 (0 other responses)
- PASS: exactly the allowed number was accepted (500, expected 500)
- PASS: usage never exceeds the allowance (used 5000 of 5000)
- PASS: remaining matches (remaining 0)
- PASS: users' usage adds up to the account's (users 5000)
- PASS: every rejection came from the account allowance (0 unexpected)
- PASS: every request is in the history exactly once (history 1000, sent 1000)

## Retries under load

300 request ids, each sent 3 times at almost the same moment, against a user allowance of 1000.

Outcomes: accepted 100, accepted (replay) 200, rejected 200, rejected (replay) 400

- PASS: every response was HTTP 200 (0 other responses)
- PASS: each request id got exactly one first-time answer (300 of 300)
- PASS: all other answers were replays (600 replays)
- PASS: retries were not counted twice (used 1000, expected 1000)
- PASS: the right number was accepted (100, expected 100)
- PASS: history has one record per request id (history 300, ids 300)

## Plan changes during load

The account allowance is switched between 6000 and 12000 every 25 ms while 3000 requests of 5 units arrive.

Outcomes: accepted 2097, rejected 903

- PASS: every response was HTTP 200 (0 other responses)
- PASS: plan changes were applied while the load ran (54 updates, 0 failed)
- PASS: stored usage equals accepted units (stored 10485, accepted 10485)
- PASS: usage never exceeded the highest allowance (used 10485, highest allowance 12000)
- PASS: every request is in the history exactly once (history 3000, sent 3000)
- PASS: an allowance lowered below usage shows 0 remaining and rejects (remaining 0)
