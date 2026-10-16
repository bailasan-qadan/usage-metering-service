import { app } from "./app.js";
import { runMigrations } from "./db/migrate.js";
import { seedPredefinedPlans } from "./db/seed.js";

function getPort(): number {
  const parsed = Number(process.env.PORT);
  if (!process.env.PORT || Number.isNaN(parsed)) {
    return 3000;
  }
  return parsed;
}

async function main(): Promise<void> {
  await runMigrations();
  await seedPredefinedPlans();

  const port: number = getPort();
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

main().catch((error: unknown) => {
  console.error("Failed to start service:", error);
  process.exit(1);
});
