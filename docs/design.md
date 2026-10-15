# Design

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
