// SPDX-License-Identifier: Apache-2.0
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { textResult, withErrorHandling, type ToolContext } from "./shared.js";

export function registerGetQuotaStatus(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "get_quota_status",
    {
      title: "View the remaining API request quota",
      description:
        "Returns how many requests have already been sent to the MetExplore API and how many " +
        "remain for the current MCP session (limit set by METEXPLORE_MAX_REQUESTS_PER_SESSION).",
      inputSchema: {},
    },
    withErrorHandling(async (_args, { client, config }) => {
      return textResult(
        `API requests used: ${client.requestsUsed}/${config.maxRequestsPerSession} ` +
          `(${client.requestsRemaining} remaining).`,
      );
    }, ctx),
  );
}
