import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Config } from "./config.js";
import { createMcpServer } from "./server.js";

/** Local use: a single MCP session for the whole process lifetime, credentials from .env. */
export async function startStdio(config: Config): Promise<void> {
  const { server, ctx } = createMcpServer(config, "stdio");
  await server.connect(new StdioServerTransport());
  console.error(
    `[mcp-metexplore] Server started on stdio (API: ${config.apiUrl}, ` +
      `quota: ${config.maxRequestsPerSession} req/session` +
      `${ctx.client.isAnonymous ? ", anonymous: public networks only" : ""})`,
  );
}
