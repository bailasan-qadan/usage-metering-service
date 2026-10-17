export type ServiceResponse = { status: number; body: unknown };

type RequestOptions = { key?: string; body?: unknown };

export async function request(
  baseUrl: string,
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<ServiceResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.key !== undefined) {
    headers["X-API-Key"] = options.key;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text === "" ? undefined : JSON.parse(text),
  };
}

// The service may still be starting when the client starts (for example with
// Docker Compose). Any HTTP answer, even a 401, means it is up.
export async function waitForService(
  baseUrl: string,
  attempts = 30,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await fetch(`${baseUrl}/plans`);
      return;
    } catch {
      console.log(`Waiting for the metering service (${attempt}/${attempts})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`The metering service at ${baseUrl} is not reachable`);
}

// --- reading JSON without `any` -------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function get(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split(".")) {
    if (Array.isArray(current)) {
      current = current[Number(key)];
    } else if (isRecord(current)) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

export function readString(value: unknown, path: string): string {
  const found = get(value, path);
  if (typeof found !== "string") {
    throw new Error(`Expected a string at '${path}' in the service response`);
  }
  return found;
}

export function readList(value: unknown, path: string): unknown[] {
  const found = get(value, path);
  if (!Array.isArray(found)) {
    throw new Error(`Expected a list at '${path}' in the service response`);
  }
  return found;
}
