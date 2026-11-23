// SPDX-License-Identifier: Apache-2.0
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { MetExploreApiClient } from "../apiClient.js";
import type { MetExploreCache } from "../cache.js";
import type { Config } from "../config.js";
import { MetExploreApiError, MetExploreAuthError, MetExploreQuotaError } from "../errors.js";

export interface ToolContext {
  client: MetExploreApiClient;
  cache: MetExploreCache;
  config: Config;
}

export function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}

export function jsonResult(data: unknown): CallToolResult {
  return textResult(JSON.stringify(data, null, 2));
}

/** Wraps a tool handler to translate known errors into clear MCP responses. */
export function withErrorHandling(
  fn: (args: any, ctx: ToolContext) => Promise<CallToolResult>,
  ctx: ToolContext,
): (args: any) => Promise<CallToolResult> {
  return async (args: any) => {
    try {
      return await fn(args, ctx);
    } catch (err) {
      if (err instanceof MetExploreAuthError) {
        return textResult(`Authentication error: ${err.message}`, true);
      }
      if (err instanceof MetExploreQuotaError) {
        return textResult(err.message, true);
      }
      if (err instanceof MetExploreApiError) {
        return textResult(`MetExplore API error (HTTP ${err.status}): ${err.message}`, true);
      }
      return textResult(`Unexpected error: ${(err as Error).message}`, true);
    }
  };
}
