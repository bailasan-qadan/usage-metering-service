export type Level = "user" | "account";
export type Rule = "max_per_request" | "monthly_allowance";

export type Rejection = { level: Level; rule: Rule };

export type Decision =
  | { accepted: true }
  | { accepted: false; rejection: Rejection };

export type LevelState = {
  monthlyAllowance: number;
  maxPerRequest: number;
  used: number;
};

export function remainingUnits(state: LevelState): number {
  return Math.max(0, state.monthlyAllowance - state.used);
}

function reject(level: Level, rule: Rule): Decision {
  return { accepted: false, rejection: { level, rule } };
}

export function decide(
  units: number,
  user: LevelState,
  account: LevelState,
): Decision {
  if (units > user.maxPerRequest) return reject("user", "max_per_request");
  if (units > account.maxPerRequest) return reject("account", "max_per_request");
  if (units > remainingUnits(user)) return reject("user", "monthly_allowance");
  if (units > remainingUnits(account)) {
    return reject("account", "monthly_allowance");
  }
  return { accepted: true };
}

export function describeRejection({ level, rule }: Rejection): string {
  const owner = level === "user" ? "user's" : "account's";
  return rule === "max_per_request"
    ? `The request is larger than the ${owner} maximum units per request`
    : `The ${owner} monthly allowance does not have enough units remaining`;
}
