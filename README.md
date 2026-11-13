# mcp-metexplore

MCP (Model Context Protocol) server for querying the
[MetExplore API](https://metexplore.pages-forge.inrae.fr/metexplore-api/metexplore3-nodejs-api/)
from any MCP-compatible client (Claude Desktop, Claude Code, VS Code...).

It exposes tools to:
- search for a MetExplore organism/network, with disambiguation when several
  networks match (e.g. "Homo sapiens");
- search for a metabolite in a network, with disambiguation (id, full name,
  chemical formula, cross-references);
- count/list the reactions involving a metabolite;
- map a list of metabolite identifiers onto a network and produce a report
  (mapped / not found / ambiguous);
- export a network as SBML;
- check the remaining API request quota for the current session.


## Installation

```bash
git clone <gitlab-repo-url> mcp-metexplore
cd mcp-metexplore
npm install
npm run build
cp .env.example .env
# edit .env: see the Configuration section below
```

## Configuration (`.env`)

| Variable | Required | Description |
|---|---|---|
| `METEXPLORE_API_URL` | no (default `http://localhost:1337`) | Base URL of the MetExplore API, no trailing slash |
| `METEXPLORE_APP_KEY` | yes | Application token (`x-app-key` header) |
| `METEXPLORE_USER_TOKEN` | yes if login/password are absent | A user token already obtained |
| `METEXPLORE_USER_LOGIN` / `METEXPLORE_USER_PASSWORD` | yes if `METEXPLORE_USER_TOKEN` is absent | Credentials used to call `/users/login` on first use |
| `METEXPLORE_MAX_REQUESTS_PER_SESSION` | no (default `20`) | Max number of requests sent to the API per session (process lifetime) |
| `METEXPLORE_EXPORT_DIR` | no (default `./exports`) | Directory where exported files are written |
| `METEXPLORE_TLS_REJECT_UNAUTHORIZED` | no (default `true`) | Set to `false` to disable TLS certificate verification (see "Known limitations") |

If `METEXPLORE_APP_KEY` is missing, the server refuses to start with an
explicit message instead of failing later with a confusing 401. Likewise, any
authentication error returned by the API (missing/invalid/expired app or user
token) is translated into a clear message stating which variable to check in
`.env`.

## Using it with an MCP client

Example configuration for Claude Desktop / Claude Code
(`claude_desktop_config.json` or equivalent):

```json
{
  "mcpServers": {
    "metexplore": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-metexplore/dist/index.js"]
    }
  }
}
```

Environment variables can also be passed directly in this configuration block
(`"env": {...}`) instead of via a `.env` file.
	
## Example questions

- "In how many reactions is glucose involved in humans?"
  → `search_organisms("Homo sapiens")`, then `search_metabolites`, then
  `count_reactions_for_metabolite`.
- "I have this file of metabolite identifiers, map it onto Ralstonia and give
  me a report." → `search_organisms("Ralstonia")` then `map_metabolites`.
- "Export the SBML network for Arabidopsis." → `search_organisms("Arabidopsis")`
  then `export_network_sbml`.

## API request quota

To avoid overloading the MetExplore API, the server limits the number of HTTP
requests actually sent to `METEXPLORE_MAX_REQUESTS_PER_SESSION` (20 by
default) for the whole process lifetime. An in-memory cache (network list,
metabolites per network) avoids re-spending this quota on repeated searches
over the same data. The remaining quota can be checked with the
`get_quota_status` tool. Once the quota is reached, the MCP server must be
restarted to get a fresh one.

Note: SBML export is asynchronous on the API side (a job to poll) and can by
itself consume several requests from the quota while the job completes.

## Development

```bash
npm run dev    # TypeScript compilation in watch mode
npm test       # unit tests (node:test, mocked fetch)
```

To test interactively against a local MetExplore instance
(`http://localhost:1337` by default):

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Note: the inspector's `--cli` mode spawns the server without inheriting the
invoking shell's custom environment variables — put test configuration in
`.env` (read by the server itself via `dotenv`) rather than relying on
shell-level `VAR=value` prefixes when testing this way.

## Known limitations / next steps

- Only one transport is implemented (`stdio`, for local use). Adding an
  HTTP/SSE transport for a shared server deployment is possible without
  changing the tools' logic, but will require indexing the request quota by
  MCP session rather than by process.
- `GET /networks` and `GET /metabolites` don't support server-side filtering
  by name: searching happens client-side over the full (cached) list. For a
  very large network, the first metabolite search can be sizeable.
- Only SBML export is currently available on the MetExplore API side.
- When pointing at the production instance
  (`https://metexplore.toulouse.inrae.fr/metexplore3-api`), calls fail with
  `unable to verify the first certificate`: the server only serves its leaf
  certificate, without its CA's intermediate certificate ("GEANT TLS RSA 1").
  This isn't Node.js-specific — a plain `curl` on the same machine fails the
  same way (`unable to get local issuer certificate`); the server really does
  serve an incomplete chain. Other MetExplore client code in the wider
  codebase works around this by disabling TLS verification entirely
  (`rejectUnauthorized: false`), not by resolving the chain differently.
  The real fix belongs on the server side (configure the full certificate
  chain, e.g. `SSLCertificateChainFile` on Apache). Two client-side
  workarounds, safest first:
  1. `NODE_EXTRA_CA_CERTS=/path/to/intermediate.pem` with the intermediate
     certificate exported from a browser that displays the site (keeps TLS
     verification active).
  2. `METEXPLORE_TLS_REJECT_UNAUTHORIZED=false` in `.env` — disables
     certificate verification entirely, so it's vulnerable to TLS
     interception. Only use this if you trust the network path to the server.
