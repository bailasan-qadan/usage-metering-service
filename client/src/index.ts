import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  isDemoUser,
  isUserPlanName,
  loadState,
  processDocument,
  setCompanyAllowance,
  setUpDemo,
  switchUserPlan,
  type Session,
} from "./demo.js";
import { isRecord, waitForService } from "./meteringApi.js";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : JSON.parse(text);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function badInput(res: ServerResponse, message: string): void {
  sendJson(res, 400, { error: { code: "invalid_input", message } });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  session: Session,
  page: string,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  switch (`${req.method} ${url.pathname}`) {
    case "GET /": {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page);
      return;
    }

    case "GET /api/state": {
      sendJson(res, 200, await loadState(session));
      return;
    }

    case "POST /api/process": {
      const body = await readJsonBody(req);
      const userId = isRecord(body) ? body.userId : undefined;
      if (!isRecord(body) || !isDemoUser(userId)) {
        badInput(res, "Choose one of the demo users: alice or bob.");
        return;
      }
      const result = await processDocument(session, userId, body.pages);
      sendJson(res, result.status, result.body);
      return;
    }

    case "POST /api/user-plan": {
      const body = await readJsonBody(req);
      const userId = isRecord(body) ? body.userId : undefined;
      const plan = isRecord(body) ? body.plan : undefined;
      if (!isDemoUser(userId) || !isUserPlanName(plan)) {
        badInput(res, "Choose a demo user and the plan basic or premium.");
        return;
      }
      const result = await switchUserPlan(session, userId, plan);
      sendJson(res, result.status, result.body);
      return;
    }

    case "POST /api/company-allowance": {
      const body = await readJsonBody(req);
      if (!isRecord(body)) {
        badInput(res, "Send a JSON object with monthlyAllowance.");
        return;
      }
      const result = await setCompanyAllowance(session, body.monthlyAllowance);
      sendJson(res, result.status, result.body);
      return;
    }

    default: {
      sendJson(res, 404, {
        error: { code: "not_found", message: "Unknown route" },
      });
    }
  }
}

async function main(): Promise<void> {
  await waitForService(config.meteringUrl);
  const session = await setUpDemo();
  const page = await readFile(join(publicDir, "index.html"), "utf8");

  const server = createServer((req, res) => {
    handle(req, res, session, page).catch((error: unknown) => {
      if (error instanceof SyntaxError) {
        badInput(res, "The request body is not valid JSON.");
        return;
      }
      console.error(error);
      sendJson(res, 502, {
        error: {
          code: "service_unreachable",
          message: "The metering service could not be reached.",
        },
      });
    });
  });

  server.listen(config.port, () => {
    console.log(`Demo account ready. Open http://localhost:${config.port}`);
  });
}

main().catch((error: unknown) => {
  console.error("The example client could not start:", error);
  process.exit(1);
});
