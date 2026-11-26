// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { renderRows, type OutputFormat } from "../format.js";
import { METEXPLORE_QUERY_ANNOTATIONS, textResult, withErrorHandling, type ToolContext } from "./shared.js";

export const countReactionsInputSchema = {
  id_network: z.number().int().describe("Id of the MetExplore network"),
  id_metabolite: z
    .number()
    .int()
    .describe("Internal id of the metabolite (obtained via search_metabolites), not its db_identifier"),
  output_format: z
    .enum(["table", "text"])
    .optional()
    .describe("Format of the list of reactions: markdown table or text. Default: table."),
};

export function registerCountReactionsForMetabolite(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "count_reactions_for_metabolite",
    {
      title: "Count the reactions involving a metabolite",
      description:
        "Returns the number and list of reactions (id, db_identifier, name) in the network that involve a given metabolite. " +
        "The metabolite must first be resolved to an internal id via search_metabolites.",
      inputSchema: countReactionsInputSchema,
      annotations: METEXPLORE_QUERY_ANNOTATIONS,
    },
    withErrorHandling(async (args, { client, cache }) => {
      const format: OutputFormat = args.output_format ?? "table";
      const res = await client.filterReactionsByMetabolites([args.id_metabolite]);
      // The /filter endpoint does not fill `names`: take them from the (cached) reactions of the network.
      const namesById = new Map<number, string>();
      if (res.ids.length > 0 && !res.ids.every((_, i) => res.names?.[i])) {
        for (const reaction of await cache.getReactions(args.id_network)) {
          namesById.set(reaction.id, reaction.name);
        }
      }
      const rows = res.ids.map((id, i) => ({
        id,
        db_identifier: res.db_identifiers[i],
        name: res.names?.[i] || namesById.get(id) || "",
      }));
      return textResult(
        `Metabolite ${args.id_metabolite} is involved in ${res.ids.length} reaction(s) ` +
          `in network ${args.id_network}.\n\n${renderRows(format, rows)}`,
      );
    }, ctx),
  );
}
