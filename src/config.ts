// SPDX-License-Identifier: Apache-2.0
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Look for a .env at the package root (dist/..), then in the current working directory.
loadDotenv({ path: path.join(here, "..", ".env"), quiet: true });
loadDotenv({ quiet: true });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function intEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer (got "${raw}").`);
  }
  return value;
}

export type TransportMode = "stdio" | "http";

export interface Config {
  apiUrl: string;
  appKey: string;
  /** Optional: without any user credentials, the API is queried anonymously (public networks only). */
  userToken?: string;
  userLogin?: string;
  userPassword?: string;
  maxRequestsPerSession: number;
  tlsRejectUnauthorized: boolean;
}

export interface HttpConfig {
  host: string;
  port: number;
  /** Accepted Host header values (hostname, without port). Empty = no check. */
  allowedHosts: string[];
  /** Behind a reverse proxy: take the client IP from the right-most X-Forwarded-For entry. */
  trustProxy: boolean;
  /** Max HTTP requests per client IP per minute on the MCP endpoint. */
  rateLimitPerMinute: number;
  maxSessions: number;
  sessionTtlMs: number;
}

export function loadConfig(): Config {
  const apiUrl = (process.env.METEXPLORE_API_URL ?? "https://metexplore.toulouse.inrae.fr/metexplore3-api").replace(/\/+$/, "");
  const appKey = requireEnv("METEXPLORE_APP_KEY");
  const userToken = process.env.METEXPLORE_USER_TOKEN || undefined;
  const userLogin = process.env.METEXPLORE_USER_LOGIN || undefined;
  const userPassword = process.env.METEXPLORE_USER_PASSWORD || undefined;
  const maxRequestsPerSession = intEnv("METEXPLORE_MAX_REQUESTS_PER_SESSION", 20);
  // TLS verification is enabled by default; only disable it if explicitly requested (MetExplore
  // server with a certificate chain known to be incomplete).
  const tlsRejectUnauthorized = process.env.METEXPLORE_TLS_REJECT_UNAUTHORIZED !== "false";

  if ((userLogin && !userPassword) || (!userLogin && userPassword)) {
    throw new Error("METEXPLORE_USER_LOGIN and METEXPLORE_USER_PASSWORD must be set together.");
  }

  return {
    apiUrl,
    appKey,
    userToken,
    userLogin,
    userPassword,
    maxRequestsPerSession,
    tlsRejectUnauthorized,
  };
}

export function loadTransportMode(): TransportMode {
  const raw = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();
  if (raw !== "stdio" && raw !== "http") {
    throw new Error(`MCP_TRANSPORT must be "stdio" or "http" (got "${raw}").`);
  }
  return raw;
}

export function loadHttpConfig(): HttpConfig {
  return {
    host: process.env.MCP_HTTP_HOST || "127.0.0.1",
    port: intEnv("MCP_HTTP_PORT", 3000),
    allowedHosts: (process.env.MCP_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    trustProxy: process.env.MCP_TRUST_PROXY === "true",
    rateLimitPerMinute: intEnv("MCP_RATE_LIMIT_PER_MINUTE", 60),
    maxSessions: intEnv("MCP_MAX_SESSIONS", 200),
    sessionTtlMs: intEnv("MCP_SESSION_TTL_MINUTES", 30) * 60_000,
  };
}
