import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Config, HttpConfig } from "./config.js";
import { USER_TOKEN_HEADER } from "./errors.js";
import { createMcpServer } from "./server.js";

const MCP_PATH = "/mcp";
const HEALTH_PATH = "/health";
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_TOKEN_LENGTH = 4096;
const SWEEP_INTERVAL_MS = 60_000;
const RATE_WINDOW_MS = 60_000;

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastSeen: number;
}

export interface HttpServerHandle {
  /** Base URL the server listens on, e.g. http://127.0.0.1:3000 */
  url: string;
  sessionCount(): number;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function sendJsonRpcError(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}) {
  sendJson(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null }, headers);
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw new HttpError(400, "Parse error: invalid JSON body");
  }
}

/** Fixed-window, in-memory request counter per client IP. */
class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly limitPerWindow: number) {}

  /** Returns the number of seconds to wait if the request is over the limit, otherwise 0. */
  hit(key: string, now = Date.now()): number {
    let w = this.windows.get(key);
    if (!w || now - w.start >= RATE_WINDOW_MS) {
      w = { start: now, count: 0 };
      this.windows.set(key, w);
    }
    w.count += 1;
    if (w.count <= this.limitPerWindow) return 0;
    return Math.max(1, Math.ceil((w.start + RATE_WINDOW_MS - now) / 1000));
  }

  prune(now = Date.now()) {
    for (const [key, w] of this.windows) {
      if (now - w.start >= RATE_WINDOW_MS) this.windows.delete(key);
    }
  }
}

/**
 * Client IP. Behind a reverse proxy (MCP_TRUST_PROXY=true), the proxy appends the real client
 * address to X-Forwarded-For, so the right-most entry is the one we can trust.
 */
function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = headerValue(req, "x-forwarded-for");
    const last = xff?.split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function hostnameOf(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) return undefined;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Remote use: MCP Streamable HTTP transport, stateful. Each MCP session gets its own MetExplore
 * client (own request quota, own cache) bound to the user token sent in the X-MetExplore-Token
 * header at initialization; without that header, the session is anonymous (public networks only).
 * The server-side .env never provides user credentials in this mode.
 */
export async function startHttp(config: Config, httpConfig: HttpConfig): Promise<HttpServerHandle> {
  const sessions = new Map<string, Session>();
  const limiter = new RateLimiter(httpConfig.rateLimitPerMinute);
  // Only the app key is shared; user credentials come exclusively from each client's header.
  const sharedConfig: Config = { ...config, userToken: undefined, userLogin: undefined, userPassword: undefined };

  async function closeSession(id: string, reason: string) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    console.error(`[mcp-metexplore] Session closed (${reason}); active sessions: ${sessions.size}`);
    await session.transport.close().catch(() => {});
    await session.server.close().catch(() => {});
  }

  async function handleMcp(req: IncomingMessage, res: ServerResponse) {
    const sessionId = headerValue(req, "mcp-session-id");
    const existing = sessionId ? sessions.get(sessionId) : undefined;

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (existing) {
        existing.lastSeen = Date.now();
        await existing.transport.handleRequest(req, res, body);
        return;
      }
      if (sessionId) throw new HttpError(404, "Session not found (expired or closed): re-initialize");
      if (!isInitializeRequest(body)) {
        throw new HttpError(400, "Bad Request: no valid session ID provided");
      }
      if (sessions.size >= httpConfig.maxSessions) {
        throw new HttpError(503, "Too many active MCP sessions on this server, try again later");
      }

      const userToken = headerValue(req, USER_TOKEN_HEADER);
      if (userToken && userToken.length > MAX_TOKEN_LENGTH) {
        throw new HttpError(400, "X-MetExplore-Token header too long");
      }
      const { server } = createMcpServer({ ...sharedConfig, userToken }, "http");
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        // Plain JSON responses to POSTs: friendlier to reverse proxies than SSE, and no tool streams.
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server, lastSeen: Date.now() });
          console.error(
            `[mcp-metexplore] Session opened (${userToken ? "authenticated" : "anonymous"}); ` +
              `active sessions: ${sessions.size}`,
          );
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) void closeSession(transport.sessionId, "closed by client");
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      if (!sessionId) throw new HttpError(400, "Bad Request: missing mcp-session-id header");
      if (!existing) throw new HttpError(404, "Session not found (expired or closed): re-initialize");
      existing.lastSeen = Date.now();
      await existing.transport.handleRequest(req, res);
      return;
    }

    throw new HttpError(405, "Method not allowed");
  }

  const httpServer = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;

      if (path === HEALTH_PATH && req.method === "GET") {
        sendJson(res, 200, { status: "ok", sessions: sessions.size });
        return;
      }

      if (httpConfig.allowedHosts.length > 0) {
        const host = hostnameOf(headerValue(req, "host"));
        if (!host || !httpConfig.allowedHosts.includes(host)) {
          throw new HttpError(403, "Forbidden: invalid Host header");
        }
      }

      if (path !== MCP_PATH) throw new HttpError(404, "Not found");

      const retryAfter = limiter.hit(clientIp(req, httpConfig.trustProxy));
      if (retryAfter > 0) {
        sendJsonRpcError(res, 429, "Too many requests, slow down", { "retry-after": String(retryAfter) });
        return;
      }

      await handleMcp(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        sendJsonRpcError(res, err.status, err.message);
      } else {
        console.error("[mcp-metexplore] Error handling HTTP request:", err);
        sendJsonRpcError(res, 500, "Internal server error");
      }
    }
  });

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastSeen > httpConfig.sessionTtlMs) void closeSession(id, "idle timeout");
    }
    limiter.prune(now);
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(httpConfig.port, httpConfig.host, () => resolve());
  });
  const address = httpServer.address() as AddressInfo;
  const hostForUrl = address.family === "IPv6" ? `[${address.address}]` : address.address;
  const url = `http://${hostForUrl}:${address.port}`;

  console.error(
    `[mcp-metexplore] Server started on ${url}${MCP_PATH} (API: ${config.apiUrl}, ` +
      `quota: ${config.maxRequestsPerSession} req/session, ` +
      `allowed hosts: ${httpConfig.allowedHosts.length ? httpConfig.allowedHosts.join(", ") : "any"})`,
  );
  if (config.userToken || config.userLogin) {
    console.error(
      "[mcp-metexplore] Note: METEXPLORE_USER_* variables are ignored in HTTP mode; " +
        "clients send their own token in the X-MetExplore-Token header.",
    );
  }

  return {
    url,
    sessionCount: () => sessions.size,
    async close() {
      clearInterval(sweeper);
      await Promise.all([...sessions.keys()].map((id) => closeSession(id, "server shutdown")));
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
