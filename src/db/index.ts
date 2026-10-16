import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "../config.js";
import * as schema from "./schema.js";

export const client = postgres(requireEnv("DATABASE_URL"));
export const db = drizzle(client, { schema });
