import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { createClient } from "redis";
import {
  remember,
  recall,
  recallRelevant,
  forget,
  count
} from "./memory.js";
import {
  getConversation,
  addMessage,
  clearConversation
} from "./session.js";
import { chat, pingOllama, chatModel } from "./ollama.js";
import { ingestText } from "./ingest.js";
import { generateTest, reviewTest, analyzeCoverage, analyzeTestResults } from "./testtools.js";
import {
  getStatus as getAutomationStatus,
  listTestFiles,
  readTestFile,
  listPageObjects,
  getPageObjectContext,
  writeTestFile
} from "./automation.js";

import type {
  IncomingMessage,
  ServerResponse
} from "node:http";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://qa:qa_password@localhost:5432/qa_brain";

const redisUrl =
  process.env.REDIS_URL ?? "redis://localhost:6379";

const port = Number(process.env.PORT ?? 3000);

// Resolves relative to cwd — works in both Docker (/app) and local dev (agent/)
const publicDir = resolve(process.env.PUBLIC_DIR ?? "public");

// --- startup health checks ---

async function checkPostgres(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query("SELECT 1");
    console.log("✓ PostgreSQL connected");
  } finally {
    await client.end();
  }
}

async function checkRedis(): Promise<void> {
  const redis = createClient({ url: redisUrl });
  redis.on("error", () => {});
  try {
    await redis.connect();
    await redis.ping();
    console.log("✓ Redis connected");
  } finally {
    await redis.quit();
  }
}

// --- HTTP helpers ---

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function send(
  res: ServerResponse,
  status: number,
  data: unknown
): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

function sendError(
  res: ServerResponse,
  status: number,
  message: string
): void {
  send(res, status, { error: message });
}

function serveFile(
  res: ServerResponse,
  filePath: string,
  contentType: string
): void {
  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

// --- route handlers ---

async function handleHealth(res: ServerResponse): Promise<void> {
  const memCount = await count();
  send(res, 200, {
    status: "ok",
    agent: "testa",
    model: chatModel,
    memories: memCount
  });
}

async function handleChat(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = (await readBody(req)) as Record<string, unknown>;
  const message =
    typeof body.message === "string" ? body.message.trim() : null;

  if (!message) {
    sendError(res, 400, "message is required");
    return;
  }

  const sessionId =
    typeof body.sessionId === "string"
      ? body.sessionId
      : crypto.randomUUID();

  // Load conversation history and relevant memories in parallel
  const [history, memories] = await Promise.all([
    getConversation(sessionId, 10),
    recallRelevant(message, 6)
  ]);

  const knowledge = memories
    .map(m => `[${m.memoryType}] ${m.content}`)
    .join("\n");

  const messages = [
    ...history,
    { role: "user" as const, content: message }
  ];

  const answer = await chat(messages, knowledge);

  // Persist conversation turns
  await Promise.all([
    addMessage(sessionId, { role: "user", content: message }),
    addMessage(sessionId, { role: "assistant", content: answer })
  ]);

  send(res, 200, {
    sessionId,
    agent: "testa",
    model: chatModel,
    question: message,
    answer,
    memoriesUsed: memories.length,
    memories: memories.map(m => ({
      id: m.id,
      content: m.content,
      type: m.memoryType,
      similarity: m.similarity
    }))
  });
}

async function handleGetMemory(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url!, `http://localhost`);
  const q = url.searchParams.get("q");
  const limit = Math.min(
    Number(url.searchParams.get("limit") ?? "30"),
    100
  );

  const [memories, total] = await Promise.all([
    q ? recallRelevant(q, limit) : recall(limit),
    count()
  ]);

  send(res, 200, { total, memories });
}

async function handlePostMemory(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = (await readBody(req)) as Record<string, unknown>;
  const content =
    typeof body.content === "string" ? body.content.trim() : null;

  if (!content) {
    sendError(res, 400, "content is required");
    return;
  }

  const memoryType =
    typeof body.type === "string" ? body.type : "fact";
  const source =
    typeof body.source === "string" ? body.source : "user";
  const confidence =
    typeof body.confidence === "number" ? body.confidence : 1.0;

  const id = await remember(content, memoryType, source, confidence);
  send(res, 201, { id, content, type: memoryType, source });
}

async function handleDeleteMemory(
  id: string,
  res: ServerResponse
): Promise<void> {
  const deleted = await forget(id);
  if (deleted) {
    send(res, 200, { deleted: true, id });
  } else {
    sendError(res, 404, "Memory not found");
  }
}

async function handleSessionClear(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = (await readBody(req)) as Record<string, unknown>;
  const sessionId =
    typeof body.sessionId === "string" ? body.sessionId : null;

  if (!sessionId) {
    sendError(res, 400, "sessionId is required");
    return;
  }

  await clearConversation(sessionId);
  send(res, 200, { cleared: true, sessionId });
}

async function handleIngestText(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = (await readBody(req)) as Record<string, unknown>;
  const content =
    typeof body.content === "string" ? body.content.trim() : null;

  if (!content) {
    sendError(res, 400, "content is required");
    return;
  }

  const source =
    typeof body.source === "string" ? body.source : "ingest";
  const memoryType =
    typeof body.type === "string" ? body.type : "fact";

  const result = await ingestText(content, source, memoryType);
  send(res, 200, result);
}

async function handleGenerateTest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = (await readBody(req)) as Record<string, unknown>;
  const feature =
    typeof body.feature === "string" ? body.feature.trim() : null;

  if (!feature) {
    sendError(res, 400, "feature is required");
    return;
  }

  const portal =
    typeof body.portal === "string" ? body.portal : "admin-client";
  const featureArea =
    typeof body.featureArea === "string" ? body.featureArea : "general";

  // Load semantic memories + page object context in parallel
  const [memories, pageObjectContext] = await Promise.all([
    recallRelevant(feature, 8),
    Promise.resolve(getPageObjectContext(`${featureArea} ${feature}`))
  ]);

  const knowledge = memories
    .map(m => `[${m.memoryType}] ${m.content}`)
    .join("\n");

  const result = await generateTest(feature, knowledge, {
    portal,
    featureArea,
    pageObjectContext
  });

  send(res, 200, {
    feature,
    portal,
    featureArea,
    testCode: result.code,
    suggestedPath: result.suggestedPath,
    memoriesUsed: memories.length
  });
}

async function handleReviewTest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = (await readBody(req)) as Record<string, unknown>;
  const code =
    typeof body.code === "string" ? body.code.trim() : null;

  if (!code) {
    sendError(res, 400, "code is required");
    return;
  }

  const searchContext =
    typeof body.context === "string" ? body.context : code.slice(0, 500);

  const memories = await recallRelevant(searchContext, 8);
  const knowledge = memories
    .map(m => `[${m.memoryType}] ${m.content}`)
    .join("\n");

  const review = await reviewTest(code, knowledge);
  send(res, 200, { review, memoriesUsed: memories.length });
}

async function handleAnalyzeResults(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = (await readBody(req)) as Record<string, unknown>;
  const output =
    typeof body.output === "string" ? body.output.trim() : null;

  if (!output) {
    sendError(res, 400, "output is required (paste your Playwright terminal output)");
    return;
  }

  // Optionally load the test file that was run
  let testCode = typeof body.testCode === "string" ? body.testCode : "";
  if (!testCode && typeof body.filePath === "string" && body.filePath) {
    const loaded = readTestFile(body.filePath);
    if (loaded) testCode = loaded;
  }

  const searchContext = output.slice(0, 800);
  const memories = await recallRelevant(searchContext, 8);
  const knowledge = memories
    .map(m => `[${m.memoryType}] ${m.content}`)
    .join("\n");

  const analysis = await analyzeTestResults(output, testCode, knowledge);
  send(res, 200, { analysis, memoriesUsed: memories.length });
}

async function handleAnalyzeCoverage(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = (await readBody(req)) as Record<string, unknown>;
  const feature =
    typeof body.feature === "string" ? body.feature.trim() : null;

  if (!feature) {
    sendError(res, 400, "feature is required");
    return;
  }

  const existingTests =
    typeof body.existingTests === "string" ? body.existingTests : "";

  const memories = await recallRelevant(feature, 8);
  const knowledge = memories
    .map(m => `[${m.memoryType}] ${m.content}`)
    .join("\n");

  const analysis = await analyzeCoverage(feature, existingTests, knowledge);
  send(res, 200, { feature, analysis, memoriesUsed: memories.length });
}

// --- server ---

async function main(): Promise<void> {
  console.log("================================");
  console.log("        TESTA QA AGENT");
  console.log("================================");
  console.log(`Model:  ${chatModel}`);
  console.log(`Public: ${publicDir}`);

  await checkPostgres();
  await checkRedis();

  const ping = await pingOllama();
  console.log(`✓ Ollama: ${ping}`);

  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const rawUrl = req.url ?? "/";
    const url = rawUrl.split("?")[0];

    // CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods":
          "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end();
      return;
    }

    try {
      // Static UI
      if (method === "GET" && url === "/") {
        serveFile(
          res,
          join(publicDir, "index.html"),
          "text/html; charset=utf-8"
        );
        return;
      }

      // Health
      if (method === "GET" && url === "/health") {
        await handleHealth(res);
        return;
      }

      // Chat
      if (method === "POST" && url === "/chat") {
        await handleChat(req, res);
        return;
      }

      // Session management
      if (method === "POST" && url === "/session/clear") {
        await handleSessionClear(req, res);
        return;
      }

      // Memory CRUD
      if (method === "GET" && url === "/memory") {
        await handleGetMemory(req, res);
        return;
      }

      if (method === "POST" && url === "/memory") {
        await handlePostMemory(req, res);
        return;
      }

      if (method === "DELETE" && url.startsWith("/memory/")) {
        const id = url.slice("/memory/".length);
        await handleDeleteMemory(id, res);
        return;
      }

      // Knowledge ingestion
      if (method === "POST" && url === "/ingest/text") {
        await handleIngestText(req, res);
        return;
      }

      // Test tools
      if (method === "POST" && url === "/test/generate") {
        await handleGenerateTest(req, res);
        return;
      }

      if (method === "POST" && url === "/test/review") {
        await handleReviewTest(req, res);
        return;
      }

      if (method === "POST" && url === "/test/analyze-results") {
        await handleAnalyzeResults(req, res);
        return;
      }

      if (method === "POST" && url === "/test/coverage") {
        await handleAnalyzeCoverage(req, res);
        return;
      }

      // Automation project browsing
      if (method === "GET" && url === "/automation/status") {
        send(res, 200, getAutomationStatus());
        return;
      }

      if (method === "GET" && url.startsWith("/automation/tests")) {
        const parsedUrl = new URL(req.url!, "http://localhost");
        const filter    = parsedUrl.searchParams.get("q") ?? undefined;
        send(res, 200, listTestFiles(filter));
        return;
      }

      if (method === "GET" && url.startsWith("/automation/pages")) {
        send(res, 200, listPageObjects());
        return;
      }

      if (method === "GET" && url.startsWith("/automation/file/")) {
        const relativePath = decodeURIComponent(url.slice("/automation/file/".length));
        const content      = readTestFile(relativePath);
        if (content === null) {
          sendError(res, 404, "File not found or not accessible");
        } else {
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(content);
        }
        return;
      }

      if (method === "POST" && url === "/automation/write") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const filePath = typeof body.filePath === "string" ? body.filePath : null;
        const content  = typeof body.content  === "string" ? body.content  : null;
        const overwrite = body.overwrite === true;

        if (!filePath || !content) {
          sendError(res, 400, "filePath and content are required");
          return;
        }

        try {
          const result = writeTestFile(filePath, content, overwrite);
          send(res, 201, result);
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      sendError(res, 404, "Not found");
    } catch (error) {
      console.error("Request error:", error);
      sendError(
        res,
        500,
        error instanceof Error ? error.message : "Internal error"
      );
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log("");
    console.log("✓ TESTA AGENT READY");
    console.log(`✓ Listening on port ${port}`);
    console.log(`✓ Web UI: http://localhost:${port}`);
    console.log("");
  });
}

main().catch(error => {
  console.error("❌ Agent startup failed:", error);
  process.exit(1);
});
