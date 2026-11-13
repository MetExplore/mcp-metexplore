import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, loadHttpConfig, loadTransportMode } from "../src/config.js";

const KEYS = [
  "METEXPLORE_APP_KEY",
  "METEXPLORE_USER_TOKEN",
  "METEXPLORE_USER_LOGIN",
  "METEXPLORE_USER_PASSWORD",
  "MCP_TRANSPORT",
  "MCP_ALLOWED_HOSTS",
  "MCP_HTTP_PORT",
];

function withEnv(t: { after: (fn: () => void) => void }, env: Record<string, string | undefined>) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
}

test("accepts a configuration without any user credentials (anonymous access)", (t) => {
  withEnv(t, { METEXPLORE_APP_KEY: "k" });
  const config = loadConfig();
  assert.equal(config.userToken, undefined);
  assert.equal(config.userLogin, undefined);
});

test("still requires METEXPLORE_APP_KEY", (t) => {
  withEnv(t, {});
  assert.throws(() => loadConfig(), /METEXPLORE_APP_KEY/);
});

test("rejects a login without a password", (t) => {
  withEnv(t, { METEXPLORE_APP_KEY: "k", METEXPLORE_USER_LOGIN: "bob" });
  assert.throws(() => loadConfig(), /together/);
});

test("defaults to stdio transport and validates MCP_TRANSPORT", (t) => {
  withEnv(t, {});
  assert.equal(loadTransportMode(), "stdio");
  process.env.MCP_TRANSPORT = "HTTP";
  assert.equal(loadTransportMode(), "http");
  process.env.MCP_TRANSPORT = "sse";
  assert.throws(() => loadTransportMode(), /MCP_TRANSPORT/);
});

test("parses MCP_ALLOWED_HOSTS and MCP_HTTP_PORT", (t) => {
  withEnv(t, { MCP_ALLOWED_HOSTS: " MCP.example.org , localhost ", MCP_HTTP_PORT: "8080" });
  const http = loadHttpConfig();
  assert.deepEqual(http.allowedHosts, ["mcp.example.org", "localhost"]);
  assert.equal(http.port, 8080);
  process.env.MCP_HTTP_PORT = "abc";
  assert.throws(() => loadHttpConfig(), /MCP_HTTP_PORT/);
});
