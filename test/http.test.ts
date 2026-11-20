import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { startHttp, type HttpServerHandle } from "../src/http.js";
import type { Config, HttpConfig } from "../src/config.js";

/** Fake MetExplore API: records the Authorization header of every call. */
const apiCalls: { path: string; authorization?: string }[] = [];
let fakeApi: http.Server;
let fakeApiUrl: string;

before(async () => {
  fakeApi = http.createServer((req, res) => {
    apiCalls.push({ path: req.url ?? "", authorization: req.headers.authorization });
    res.writeHead(200, { "content-type": "application/json" });
    const networks = [{ id: 1, name: "Public network", organism_name: "Escherichia coli" }];
    if (req.headers.authorization) networks.push({ id: 2, name: "Private network", organism_name: "Escherichia coli" });
    res.end(JSON.stringify({ success: true, message: "OK", status: 200, networks }));
  });
  await new Promise<void>((resolve) => fakeApi.listen(0, "127.0.0.1", resolve));
  fakeApiUrl = `http://127.0.0.1:${(fakeApi.address() as AddressInfo).port}`;
});

after(() => {
  fakeApi.closeAllConnections();
  fakeApi.close();
});

function configs(httpOverrides: Partial<HttpConfig> = {}): [Config, HttpConfig] {
  return [
    {
      apiUrl: fakeApiUrl,
      appKey: "app-key",
      // Must be ignored in HTTP mode: never sent on behalf of remote clients.
      userToken: "server-side-token",
      maxRequestsPerSession: 3,
      tlsRejectUnauthorized: true,
    },
    {
      host: "127.0.0.1",
      port: 0,
      allowedHosts: [],
      trustProxy: false,
      rateLimitPerMinute: 1000,
      maxSessions: 10,
      sessionTtlMs: 60_000,
      ...httpOverrides,
    },
  ];
}

async function withServer(
  t: { after: (fn: () => Promise<void>) => void; mock: { method: Function } },
  httpOverrides: Partial<HttpConfig> = {},
): Promise<HttpServerHandle> {
  t.mock.method(console, "error", () => {});
  const handle = await startHttp(...configs(httpOverrides));
  t.after(() => handle.close());
  return handle;
}

let rpcId = 0;
async function rpc(
  base: string,
  method: string,
  params: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; sessionId: string | null; body: any }> {
  const isNotification = method.startsWith("notifications/");
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, ...(isNotification ? {} : { id: ++rpcId }) }),
  });
  const text = await res.text();
  return { status: res.status, sessionId: res.headers.get("mcp-session-id"), body: text ? JSON.parse(text) : undefined };
}

async function openSession(base: string, headers: Record<string, string> = {}): Promise<string> {
  const init = await rpc(
    base,
    "initialize",
    { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "test", version: "1" } },
    headers,
  );
  assert.equal(init.status, 200, JSON.stringify(init.body));
  assert.ok(init.sessionId);
  await rpc(base, "notifications/initialized", {}, { "mcp-session-id": init.sessionId });
  return init.sessionId;
}

async function callTool(base: string, sessionId: string, name: string, args: unknown = {}): Promise<string> {
  const res = await rpc(base, "tools/call", { name, arguments: args }, { "mcp-session-id": sessionId });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.result.content[0].text as string;
}

test("health endpoint reports the number of active sessions", async (t) => {
  const server = await withServer(t);
  await openSession(server.url);
  const res = await fetch(`${server.url}/health`);
  assert.deepEqual(await res.json(), { status: "ok", sessions: 1 });
});

test("exposes the tools without the SBML export", async (t) => {
  const server = await withServer(t);
  const sessionId = await openSession(server.url);
  const res = await rpc(server.url, "tools/list", {}, { "mcp-session-id": sessionId });
  const names = res.body.result.tools.map((tool: { name: string }) => tool.name).sort();
  assert.deepEqual(names, [
    "count_reactions_for_metabolite",
    "get_quota_status",
    "map_metabolites",
    "match_chebi",
    "search_metabolites",
    "search_metabolites_by_external_id",
    "search_metabolites_by_formula",
    "search_organisms",
  ]);
});

test("each session uses its own token: anonymous sessions send none, server-side token is never used", async (t) => {
  const server = await withServer(t);
  apiCalls.length = 0;

  const anonymous = await openSession(server.url);
  const authenticated = await openSession(server.url, { "x-metexplore-token": "alice-token" });

  await callTool(server.url, anonymous, "search_organisms", { query: "Escherichia" });
  await callTool(server.url, authenticated, "search_organisms", { query: "Escherichia" });

  assert.equal(apiCalls.length, 2);
  assert.equal(apiCalls[0].authorization, undefined);
  assert.equal(apiCalls[1].authorization, "Bearer alice-token");
  assert.ok(apiCalls.every((c) => c.authorization !== "Bearer server-side-token"));
});

test("the API request quota is tracked per session", async (t) => {
  const server = await withServer(t);
  const a = await openSession(server.url);
  const b = await openSession(server.url);

  await callTool(server.url, a, "search_organisms", { query: "Escherichia" });
  assert.match(await callTool(server.url, a, "get_quota_status"), /used: 1\/3/);
  assert.match(await callTool(server.url, b, "get_quota_status"), /used: 0\/3/);
});

test("rejects unknown sessions and non-initialize requests without a session", async (t) => {
  const server = await withServer(t);
  const unknown = await rpc(server.url, "tools/list", {}, { "mcp-session-id": "nope" });
  assert.equal(unknown.status, 404);
  const noSession = await rpc(server.url, "tools/list", {});
  assert.equal(noSession.status, 400);
});

test("DELETE closes the session", async (t) => {
  const server = await withServer(t);
  const sessionId = await openSession(server.url);
  assert.equal(server.sessionCount(), 1);
  const res = await fetch(`${server.url}/mcp`, {
    method: "DELETE",
    headers: { "mcp-session-id": sessionId, "mcp-protocol-version": LATEST_PROTOCOL_VERSION },
  });
  assert.equal(res.status, 200);
  assert.equal(server.sessionCount(), 0);
});

test("limits the number of concurrent sessions", async (t) => {
  const server = await withServer(t, { maxSessions: 1 });
  await openSession(server.url);
  const res = await rpc(server.url, "initialize", {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(res.status, 503);
});

test("rate-limits requests per client IP", async (t) => {
  const server = await withServer(t, { rateLimitPerMinute: 2 });
  assert.equal((await rpc(server.url, "tools/list", {})).status, 400);
  assert.equal((await rpc(server.url, "tools/list", {})).status, 400);
  const limited = await rpc(server.url, "tools/list", {});
  assert.equal(limited.status, 429);
});

test("rejects requests whose Host header is not allowed", async (t) => {
  const server = await withServer(t, { allowedHosts: ["mcp.example.org"] });
  const res = await rpc(server.url, "tools/list", {});
  assert.equal(res.status, 403);
  // The health check stays reachable (Docker healthcheck uses localhost).
  assert.equal((await fetch(`${server.url}/health`)).status, 200);
});
