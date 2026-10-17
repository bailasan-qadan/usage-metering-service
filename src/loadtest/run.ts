import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { BASE_URL, send } from "./api.js";
import { SCALE, allScenarios, warmUp, type ScenarioResult } from "./scenarios.js";

const ms = (value: number): string => value.toFixed(1);

function report(results: ScenarioResult[], startedAt: Date): string {
  const cpu = os.cpus();
  const lines: string[] = [
    "# Load test results",
    "",
    `- Date: ${startedAt.toISOString()}`,
    `- Target: ${BASE_URL}`,
    `- Node: ${process.version}`,
    `- Machine: ${cpu.length} CPUs (${cpu[0]?.model ?? "unknown"}), ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB RAM`,
    `- Scale: ${SCALE}`,
    "- The load generator, the service and the database all ran on this same machine, so the load generator competes with them for CPU.",
    "",
    "| Scenario | Requests | Concurrency | Seconds | Requests/s | p50 ms | p95 ms | p99 ms | max ms |",
    "|---|---|---|---|---|---|---|---|---|",
  ];

  for (const r of results) {
    const seconds = r.durationMs / 1000;
    lines.push(
      `| ${r.name} | ${r.requests} | ${r.concurrency} | ${seconds.toFixed(2)} | ${(r.requests / seconds).toFixed(0)} | ${ms(r.latency.p50)} | ${ms(r.latency.p95)} | ${ms(r.latency.p99)} | ${ms(r.latency.max)} |`,
    );
  }

  for (const r of results) {
    lines.push("", `## ${r.name}`, "", r.description, "");
    lines.push(
      `Outcomes: ${Object.entries(r.outcomes)
        .map(([label, count]) => `${label} ${count}`)
        .join(", ")}`,
      "",
    );
    for (const c of r.checks) {
      lines.push(`- ${c.passed ? "PASS" : "FAIL"}: ${c.label} (${c.detail})`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const reachable = await send("GET", "/plans").then(
    () => true,
    () => false,
  );
  if (!reachable) {
    throw new Error(
      `No service answers at ${BASE_URL}. Start the stack with: docker compose up -d --build`,
    );
  }

  const startedAt = new Date();
  console.log(`Load test against ${BASE_URL} (scale ${SCALE})`);
  console.log("Warming up...");
  await warmUp();

  const results: ScenarioResult[] = [];
  for (const run of allScenarios) {
    const result = await run();
    results.push(result);
    const passed = result.checks.every((c) => c.passed);
    console.log(
      `${passed ? "PASS" : "FAIL"}  ${result.name}: ${result.requests} requests in ${(result.durationMs / 1000).toFixed(2)} s`,
    );
  }

  const markdown = report(results, startedAt);
  await mkdir("loadtest", { recursive: true });
  await writeFile("loadtest/results.md", markdown);
  console.log(`\n${markdown}`);
  console.log("Saved to loadtest/results.md");

  process.exit(results.every((r) => r.checks.every((c) => c.passed)) ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("Load test failed:", error);
  process.exit(1);
});
