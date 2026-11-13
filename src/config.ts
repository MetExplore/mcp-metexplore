import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Look for a .env at the package root (dist/..), then in the current working directory.
loadDotenv({ path: path.join(here, "..", ".env") });
loadDotenv();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export interface Config {
  apiUrl: string;
  appKey: string;
  userToken?: string;
  userLogin?: string;
  userPassword?: string;
  maxRequestsPerSession: number;
  exportDir: string;
  tlsRejectUnauthorized: boolean;
}

export function loadConfig(): Config {
  const apiUrl = (process.env.METEXPLORE_API_URL ?? "http://localhost:1337").replace(/\/+$/, "");
  const appKey = requireEnv("METEXPLORE_APP_KEY");
  const userToken = process.env.METEXPLORE_USER_TOKEN || undefined;
  const userLogin = process.env.METEXPLORE_USER_LOGIN || undefined;
  const userPassword = process.env.METEXPLORE_USER_PASSWORD || undefined;
  const maxRequestsPerSession = Number(process.env.METEXPLORE_MAX_REQUESTS_PER_SESSION ?? 20);
  const exportDir = process.env.METEXPLORE_EXPORT_DIR ?? "./exports";
  // TLS verification is enabled by default; only disable it if explicitly requested (MetExplore
  // server with a certificate chain known to be incomplete).
  const tlsRejectUnauthorized = process.env.METEXPLORE_TLS_REJECT_UNAUTHORIZED !== "false";

  if (!userToken && (!userLogin || !userPassword)) {
    throw new Error(
      "No user authentication method configured: set METEXPLORE_USER_TOKEN, " +
        "or METEXPLORE_USER_LOGIN and METEXPLORE_USER_PASSWORD in .env.",
    );
  }

  return {
    apiUrl,
    appKey,
    userToken,
    userLogin,
    userPassword,
    maxRequestsPerSession,
    exportDir,
    tlsRejectUnauthorized,
  };
}
