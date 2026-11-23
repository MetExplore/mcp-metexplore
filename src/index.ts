#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { loadConfig, loadHttpConfig, loadTransportMode } from "./config.js";
import { startHttp } from "./http.js";
import { startStdio } from "./stdio.js";

async function main() {
  let config, mode, httpConfig;
  try {
    config = loadConfig();
    mode = loadTransportMode();
    if (mode === "http") httpConfig = loadHttpConfig();
  } catch (err) {
    console.error(`[mcp-metexplore] Invalid configuration: ${(err as Error).message}`);
    process.exit(1);
  }

  if (httpConfig) {
    const { close } = await startHttp(config, httpConfig);
    const shutdown = (signal: string) => {
      console.error(`[mcp-metexplore] ${signal} received, shutting down`);
      close().finally(() => process.exit(0));
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } else {
    await startStdio(config);
  }
}

main().catch((err) => {
  console.error("[mcp-metexplore] Fatal error:", err);
  process.exit(1);
});
