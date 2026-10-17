import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { requireEnv } from "../config.js";

async function ensureTestDatabase(baseUrl: string): Promise<string> {
  const url = new URL(baseUrl);
  const testName = `${url.pathname.slice(1)}_test`;

  const admin = postgres(new URL("/postgres", baseUrl).toString(), { max: 1 });
  try {
    const existing =
      await admin`SELECT 1 FROM pg_database WHERE datname = ${testName}`;
    if (existing.length === 0) {
      await admin.unsafe(`CREATE DATABASE "${testName}"`);
    }
  } finally {
    await admin.end();
  }

  url.pathname = `/${testName}`;
  return url.toString();
}

async function main(): Promise<void> {
  // Point everything at the test database BEFORE the app code is loaded.
  process.env.DATABASE_URL = await ensureTestDatabase(
    requireEnv("DATABASE_URL"),
  );

  // Same setup the service performs at startup.
  const { client } = await import("../db/index.js");
  const { runMigrations } = await import("../db/migrate.js");
  const { seedPredefinedPlans } = await import("../db/seed.js");
  await runMigrations();
  await seedPredefinedPlans();
  await client.end();

  const here = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(here)
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => join(here, name));

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "--test-concurrency=1", ...files],
    { stdio: "inherit", env: process.env },
  );
  process.exit(result.status ?? 1);
}

main().catch((error: unknown) => {
  console.error("Test run failed:", error);
  process.exit(1);
});
