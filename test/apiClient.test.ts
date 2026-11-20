import { test } from "node:test";
import assert from "node:assert/strict";
import { MetExploreApiClient } from "../src/apiClient.js";
import { MetExploreApiError, MetExploreAuthError, MetExploreQuotaError } from "../src/errors.js";
import type { Config } from "../src/config.js";

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiUrl: "http://localhost:1337",
    appKey: "app-key",
    userToken: "user-token",
    maxRequestsPerSession: 20,
    tlsRejectUnauthorized: true,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("stops making requests once the per-session quota is reached", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return jsonResponse({ success: true, message: "OK", status: 200, networks: [] });
  });

  const client = new MetExploreApiClient(baseConfig({ maxRequestsPerSession: 2 }));
  await client.getNetworks();
  await client.getNetworks();
  assert.equal(calls, 2);

  await assert.rejects(() => client.getNetworks(), MetExploreQuotaError);
  assert.equal(calls, 2, "no HTTP call should be made once the quota is exhausted");
});

test("maps a 401 'Bad app token' response to a friendly auth error mentioning the .env variable", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse({ success: false, message: "Bad app token", status: 401 }, 401),
  );

  const client = new MetExploreApiClient(baseConfig());
  await assert.rejects(
    () => client.getNetworks(),
    (err: unknown) => {
      assert.ok(err instanceof MetExploreAuthError);
      assert.match((err as Error).message, /METEXPLORE_APP_KEY/);
      return true;
    },
  );
});

test("maps a 401 'token not valid' response to a friendly user-token auth error", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse({ success: false, message: "token not valid", status: 401 }, 401),
  );

  const client = new MetExploreApiClient(baseConfig());
  await assert.rejects(
    () => client.getNetworks(),
    (err: unknown) => {
      assert.ok(err instanceof MetExploreAuthError);
      assert.match((err as Error).message, /METEXPLORE_USER_TOKEN/);
      return true;
    },
  );
});

test("wraps other API failures in MetExploreApiError with the original status", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse({ success: false, message: "boom", status: 500 }, 500),
  );

  const client = new MetExploreApiClient(baseConfig());
  await assert.rejects(
    () => client.getNetworks(),
    (err: unknown) => {
      assert.ok(err instanceof MetExploreApiError);
      assert.equal((err as MetExploreApiError).status, 500);
      return true;
    },
  );
});

test("leaves TLS certificate verification untouched by default", (t) => {
  const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  t.after(() => {
    if (before === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = before;
  });
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

  new MetExploreApiClient(baseConfig());
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
});

test("disables TLS certificate verification when tlsRejectUnauthorized is false", (t) => {
  const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  t.after(() => {
    if (before === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = before;
  });
  t.mock.method(console, "error", () => {});

  new MetExploreApiClient(baseConfig({ tlsRejectUnauthorized: false }));
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
});

test("logs in with METEXPLORE_USER_LOGIN/PASSWORD when no user token is configured", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    if (url.endsWith("/users/login")) {
      return jsonResponse({ success: true, message: "Login successed.", status: 200, user: { token: "fresh-token" } });
    }
    return jsonResponse({ success: true, message: "OK", status: 200, networks: [] });
  });

  const client = new MetExploreApiClient(
    baseConfig({ userToken: undefined, userLogin: "bob", userPassword: "secret" }),
  );
  await client.getNetworks();
  assert.equal(calls.length, 2);
  assert.ok(calls[0].endsWith("/users/login"));
});

test("sends no Authorization header and never logs in when no user credentials are configured", async (t) => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    return jsonResponse({ success: true, message: "OK", status: 200, networks: [] });
  });

  const client = new MetExploreApiClient(baseConfig({ userToken: undefined }));
  assert.equal(client.isAnonymous, true);
  await client.getNetworks();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/networks"));
  assert.equal(calls[0].headers["Authorization"], undefined);
  assert.equal(calls[0].headers["x-app-key"], "app-key");
});

test("sends the configured user token as a Bearer token", async (t) => {
  let auth: string | undefined;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    auth = (init.headers as Record<string, string>)["Authorization"];
    return jsonResponse({ success: true, message: "OK", status: 200, networks: [] });
  });

  await new MetExploreApiClient(baseConfig({ userToken: "abc" })).getNetworks();
  assert.equal(auth, "Bearer abc");
});

test("in HTTP mode, user-token auth errors point at the X-MetExplore-Token header", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse({ success: false, message: "token not valid", status: 401 }, 401),
  );

  const client = new MetExploreApiClient(baseConfig(), { mode: "http" });
  await assert.rejects(
    () => client.getNetworks(),
    (err: unknown) => {
      assert.ok(err instanceof MetExploreAuthError);
      assert.match((err as Error).message, /X-MetExplore-Token/);
      return true;
    },
  );
});

test("getNetwork reads the network details whatever the envelope", async (t) => {
  const network = { id: 7, name: "N", stats_refs_metabolites: { chebi: 3 } };
  const bodies = [{ network }, { networks: [network] }, { results: [network] }, network];
  let i = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    assert.match(String(url), /\/networks\/7$/);
    return jsonResponse({ success: true, message: "OK", status: 200, ...bodies[i++] });
  });
  const client = new MetExploreApiClient(baseConfig());
  for (let k = 0; k < bodies.length; k++) {
    const n = await client.getNetwork(7);
    assert.deepEqual(n.stats_refs_metabolites, { chebi: 3 });
  }
});

test("matchChebi posts the ChEBI inputs to /match/chebi and returns the results", async (t) => {
  const results = [{ external_identifier: "chebi:17234", name: "CHEBI:17234", matching_results: [] }];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.match(String(url), /\/match\/chebi$/);
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), {
      id_network: 5,
      inputs: [{ name: "CHEBI:17234", input_id: "chebi:17234" }],
      type: "chebi",
    });
    return jsonResponse({ success: true, message: "OK", status: 200, results });
  });
  const client = new MetExploreApiClient(baseConfig());
  assert.deepEqual(await client.matchChebi(5, [{ name: "CHEBI:17234", input_id: "chebi:17234" }]), results);
});
