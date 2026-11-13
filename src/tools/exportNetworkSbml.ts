import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { textResult, withErrorHandling, type ToolContext } from "./shared.js";

export const exportNetworkSbmlInputSchema = {
  id_network: z.number().int().describe("Id of the MetExplore network to export as SBML"),
};

const POLL_DELAYS_MS = [2000, 4000, 8000, 15000]; // backoff, capped at the last value
const MAX_POLL_ATTEMPTS = 12;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerExportNetworkSbml(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "export_network_sbml",
    {
      title: "Export a MetExplore network as SBML",
      description:
        "Starts the SBML export of a MetExplore network, waits for the server-side job to complete " +
        "(asynchronous operation), then writes the resulting file to disk and returns its path. The " +
        "target network must first be resolved via search_organisms. Note: polling the job consumes " +
        "several requests from the session quota.",
      inputSchema: exportNetworkSbmlInputSchema,
    },
    withErrorHandling(async (args, { client, config }) => {
      const jobId = await client.startSbmlExport(args.id_network);

      let attempt = 0;
      while (attempt < MAX_POLL_ATTEMPTS) {
        const job = await client.getJob(jobId);
        if (job.status === "finished") break;
        if (job.status === "failed") {
          return textResult(
            `SBML export of network ${args.id_network} failed: ${job.message ?? "unknown reason"}.`,
            true,
          );
        }
        const delay = POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)];
        await sleep(delay);
        attempt += 1;
      }
      if (attempt >= MAX_POLL_ATTEMPTS) {
        return textResult(
          `SBML export of network ${args.id_network} (job ${jobId}) is still running after ` +
            `${MAX_POLL_ATTEMPTS} checks. Try again later — the job keeps running server-side.`,
          true,
        );
      }

      const content = await client.downloadJobFile(jobId);
      await mkdir(config.exportDir, { recursive: true });
      const filename = `network-${args.id_network}-${Date.now()}.sbml`;
      const filePath = path.join(config.exportDir, filename);
      await writeFile(filePath, content, "utf-8");

      return textResult(
        `SBML export of network ${args.id_network} complete: file written to ${filePath} ` +
          `(${(content.length / 1024).toFixed(1)} KB).`,
      );
    }, ctx),
  );
}
