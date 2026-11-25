# mcp-metexplore

[![pipeline status](https://forge.inrae.fr/metexplore/mcp/mcp-metexplore/badges/main/pipeline.svg)](https://forge.inrae.fr/metexplore/mcp/mcp-metexplore/-/commits/main)
[![Latest Release](https://forge.inrae.fr/metexplore/mcp/mcp-metexplore/-/badges/release.svg)](https://forge.inrae.fr/metexplore/mcp/mcp-metexplore/-/releases)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

<!-- If your software has been certified by MetaboHUB, put the following badge here : -->
<!-- [![MetaboHUB Logo](https://forge.inrae.fr/metabohub/e-tools/template-readme-mth/-/raw/main/logos/metabohub_logo-20x20.png?ref_type=heads)![MetaboHUB title](https://img.shields.io/badge/MetaboHub-Software-0066cc?style=flat-square)](https://www.metabohub.fr) -->

## Metadata

- authors: <ludovic.cottret@inrae.fr> with claude-opus-5-5
- creation date: `2026-11-13`
- main usage: MCP (Model Context Protocol) server to query MetExplore metabolic networks from LLM clients

## Description

MCP (Model Context Protocol) server for querying the
[MetExplore API](https://metexplore.pages-forge.inrae.fr/metexplore-api/metexplore3-nodejs-api/)
from any MCP-compatible client (Claude Desktop, Claude Code, VS Code...).

It lets users ask questions about MetExplore organisms, metabolites and
reactions in natural language, the LLM client calling the MetExplore API
through the tools exposed by this server.

It can be used as a shared **remote server** (Streamable HTTP transport,
nothing to install) or run **locally** (`stdio` transport).

### Example questions

- "In how many reactions is glucose involved in humans?"
  → `search_organisms("Homo sapiens")`, then `search_metabolites`, then
  `count_reactions_for_metabolite`.
- "Give me all the metabolites with the formula C3H3O4 in Human-GEM V2."
  → `search_organisms("Human-GEM 2")` then `search_metabolites_by_formula`.
- "Which metabolites correspond to CHEBI:15422 in Human-GEM V2?"
  → `search_organisms("Human-GEM 2")` then `search_metabolites_by_external_id`.
- "Which metabolites of Human-GEM V2 are related to CHEBI:17234?"
  → `search_organisms("Human-GEM 2")` then `match_chebi`.
- "I have this file of metabolite identifiers, map it onto Ralstonia and give
  me a report." → `search_organisms("Ralstonia")` then `map_metabolites`.
- "Map these E. coli genes and tell me which pathways are enriched."
  → `search_organisms("E. coli")` then `map_genes`.

## Features

- **`search_organisms`**: search for a MetExplore organism/network, with
  disambiguation when several networks match (e.g. "Homo sapiens").
- **`search_metabolites`**: search for a metabolite in a network,
  with disambiguation (id, full name, chemical formula, cross-references).
- **`search_metabolites_by_formula`**: list every metabolite of a
  network with a given chemical formula, optionally ignoring hydrogens to catch
  all protonation states.
- **`search_metabolites_by_external_id`**: list every metabolite of a
  network cross-referenced to an external identifier (ChEBI, KEGG, HMDB,
  MetaNetX, PubChem, LipidMaps, InChI, BiGG, VMH...), after checking that the
  network contains identifiers from that database.
- **`match_chebi`**: match ChEBI identifiers to the metabolites
  of a network using the ChEBI ontology: exact matches, but also more
  generic/specific classes, conjugate acids/bases, tautomers and enantiomers,
  with their distance.
- **`count_reactions_for_metabolite`**: count/list the reactions
  involving a metabolite.
- **`map_metabolites`**: map a list of metabolite identifiers onto a
  network and produce a report (mapped / not found / ambiguous).
- **`map_genes`**: map a list of gene identifiers (exact or regular
  expression) onto a network and produce the same report, with pathway
  enrichment.
- **`get_quota_status`**: check the remaining API request quota for
  the current session.

### API request quota

To avoid overloading the MetExplore API, the server limits the number of HTTP
requests actually sent to `METEXPLORE_MAX_REQUESTS_PER_SESSION` (20 by
default) per MCP session: the whole process lifetime in stdio mode, one MCP
session (one client connection) in HTTP mode. An in-memory, per-session cache
(network list, metabolites per network) avoids re-spending this quota on
repeated searches over the same data. The remaining quota can be checked with
the `get_quota_status` tool. Once the quota is reached, restart the server
(stdio) or reconnect the client to open a new session (HTTP).

## Getting Started

The easiest way is to use the hosted remote server (no installation, no
application key). The server can also be run locally (stdio).

### Prerequisites

- **MCP client**: any MCP-compatible client (Claude Code, Claude Desktop,
  VS Code...)
- **Remote use**: nothing else
- **Local use**:
  - **Operating System**: Linux, macOS or Windows
  - **Node.js**: version 18 or higher
  - **npm**
  - a MetExplore **application key**: ask for one by email at
    [contact-metexplore@inrae.fr](mailto:contact-metexplore@inrae.fr)
- **Optional**: a MetExplore user token (available in the MetExplore interface,
  in your account profile) to access your private networks
- **Deployment only**: Docker

### Installing

#### Option 1: use the remote server

No installation and no application key are needed: the server is hosted and
already holds the MetExplore application key.

**Claude Code (one command)** — public networks only:

```bash
claude mcp add --transport http metexplore https://metexplore.toulouse.inrae.fr/metexplore-mcp/mcp
```

With your MetExplore user token, to also access your private networks:

```bash
claude mcp add --transport http metexplore https://metexplore.toulouse.inrae.fr/metexplore-mcp/mcp --header "X-MetExplore-Token: YOUR_METEXPLORE_USER-TOKEN"
```

Add `--scope user` to make the server available in all your projects.

**Other clients (`.mcp.json`, VS Code...)**:

```json
{
  "mcpServers": {
    "metexplore": {
      "type": "http",
      "url": "https://metexplore.toulouse.inrae.fr/metexplore-mcp/mcp",
      "headers": { "X-MetExplore-Token": "<your MetExplore user token>" }
    }
  }
}
```

Omit `headers` to access public networks only.

#### Option 2: local use (stdio)

The server is published on npm as
[`@metexplore/mcp-metexplore`](https://www.npmjs.com/package/@metexplore/mcp-metexplore):
`npx` downloads and runs it, nothing to install. Register it in your client,
e.g. for Claude Desktop (`claude_desktop_config.json`) or any client using the
`mcpServers` format:

```json
{
  "mcpServers": {
    "metexplore": {
      "command": "npx",
      "args": ["-y", "@metexplore/mcp-metexplore"],
      "env": {
        "METEXPLORE_APP_KEY": "<your app key>"
      }
    }
  }
}
```

Or with Claude Code:

```bash
claude mcp add metexplore --env METEXPLORE_APP_KEY=<your app key> -- npx -y @metexplore/mcp-metexplore
```

Other variables of the configuration table below can be added the same way
(`"env"` block or `--env`). Check the connection with `/mcp` in Claude Code,
then ask one of the [example questions](#example-questions).

##### From the sources

To run a modified version, install and build the server:

```bash
git clone https://forge.inrae.fr/metexplore/mcp/mcp-metexplore.git
cd mcp-metexplore
npm install
npm run build
cp .env.example .env
# edit .env: see the configuration table below
```

Configuration (`.env`, or `env` block of the client configuration):

| Variable | Required | Description |
|---|---|---|
| `METEXPLORE_API_URL` | no (default `http://localhost:1337`) | Base URL of the MetExplore API, no trailing slash |
| `METEXPLORE_APP_KEY` | yes | Application token (`x-app-key` header), to request from contact-metexplore@inrae.fr |
| `METEXPLORE_USER_TOKEN` | no (stdio only) | A user token already obtained |
| `METEXPLORE_USER_LOGIN` / `METEXPLORE_USER_PASSWORD` | no (stdio only, set together) | Credentials used to call `/users/login` on first use |
| `METEXPLORE_MAX_REQUESTS_PER_SESSION` | no (default `20`) | Max number of requests sent to the API per MCP session |
| `METEXPLORE_TLS_REJECT_UNAUTHORIZED` | no (default `true`) | Set to `false` to disable TLS certificate verification |
| `MCP_TRANSPORT` | no (default `stdio`) | `stdio` (local use) or `http` (remote deployment) |

Without any user credentials, the API is queried with the app key only: only
**public** networks are visible. HTTP-mode variables are described in
[Deployment](#deployment).

Then register the built server (instead of `npx`) in your client, e.g. for
Claude Desktop / Claude Code (`claude_desktop_config.json` or equivalent):

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

Or with Claude Code:

```bash
claude mcp add metexplore --env METEXPLORE_APP_KEY=<your app key> -- node /absolute/path/to/mcp-metexplore/dist/index.js
```

Check the connection with `/mcp` in Claude Code, then ask one of the
[example questions](#example-questions).

### Running the tests

Unit tests use `node:test` with a mocked `fetch` (no MetExplore API needed):

```bash
npm test
```

They cover the tools (search, disambiguation, formula/external id matching,
ChEBI ontology matching, mapping report), the API client, the configuration,
the output formatting and the HTTP transport.

## Deployment

### Remote deployment (HTTP)

With `MCP_TRANSPORT=http`, the server exposes the MCP
[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http)
transport on `/mcp`, plus `GET /health` (used by the Docker healthcheck).
`METEXPLORE_USER_*` variables are ignored in this mode; only
`METEXPLORE_APP_KEY` is shared by all clients.

| Variable | Default | Description |
|---|---|---|
| `MCP_HTTP_HOST` / `MCP_HTTP_PORT` | `127.0.0.1` / `3000` | Listening address (`0.0.0.0` in the Docker image) |
| `MCP_ALLOWED_HOSTS` | empty (no check) | Comma-separated public hostnames accepted in the `Host` header (DNS rebinding protection) |
| `MCP_TRUST_PROXY` | `false` | `true` behind a reverse proxy: client IP taken from `X-Forwarded-For` (set by the CI deployment) |
| `MCP_RATE_LIMIT_PER_MINUTE` | `60` | Max HTTP requests per client IP per minute on `/mcp` |
| `MCP_MAX_SESSIONS` | `200` | Max concurrent MCP sessions (503 beyond) |
| `MCP_SESSION_TTL_MINUTES` | `30` | Idle sessions are closed after this delay |

### Docker

```bash
docker build -t mcp-metexplore .
docker run --rm -p 127.0.0.1:3000:3000 \
  -e METEXPLORE_APP_KEY=... -e METEXPLORE_API_URL=... \
  -e MCP_ALLOWED_HOSTS=localhost mcp-metexplore
curl http://localhost:3000/health
```

On the servers (see [Continuous deployment](#continuous-deployment-gitlab-ci)),
the container is only bound to `127.0.0.1:${HOST_PORT}`; TLS and the public
domain name are handled by the host's reverse proxy, which must keep the
original `Host` header and should not buffer responses. Example (nginx):

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:8077;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

Apache equivalent: `ProxyPreserveHost On`,
`ProxyPass /mcp http://127.0.0.1:8077/mcp flushpackets=on timeout=3600`.

### Continuous deployment (GitLab CI)

`.gitlab-ci.yml` runs on the `vm-metexplore-dev` runner (docker executor).
The test and build jobs (`docker:27-cli` image) use the host's Docker daemon,
so the runner must mount its socket in `/etc/gitlab-runner/config.toml`:

```toml
[runners.docker]
  volumes = ["/var/run/docker.sock:/var/run/docker.sock", "/cache"]
```

Deploy jobs run in `alpine` with `openssh-client` and only need SSH access
to the VMs.

| Trigger | Jobs | Image | Target |
|---|---|---|---|
| any branch / MR | `test` | — | — |
| push on `develop` | `build:develop`, `deploy:develop` | `:develop-<sha>`, `:develop` | environment `develop` |
| tag `X.Y.Z` | `build:release`, `deploy:production`, `publish:npm`, `release` | `:X.Y.Z`, `:latest` | environment `production` + npm package + GitLab release |

**Versioning**: the git tag is the single source of truth. `package.json`
stays at `0.0.0` in the repository; the CI injects the tag as the image's
version (`--build-arg VERSION`) and as the npm package's version
(`npm version X.Y.Z --no-git-tag-version`, not committed). Develop images
report `0.0.0-develop.<sha>`.

The `publish:npm` job publishes
[`@metexplore/mcp-metexplore`](https://www.npmjs.com/package/@metexplore/mcp-metexplore)
at the tag's version (a no-op if that version is already on npm).

The `release` job creates the GitLab release of the tag (Deploy > Releases),
using the `## X.Y.Z` section of [CHANGELOG.md](CHANGELOG.md) as its description:
add that section before pushing the tag.

Deployment writes no file on the VM: the job pipes a script to `ssh … sh -s`
that pulls the image, replaces the `mcp-metexplore` container with
`docker run` (runtime configuration passed through `--env-file /dev/stdin`)
and waits for the container to be healthy. The VMs only need Docker.

Each environment can be managed from **Operate > Environments**:

- **Stop**: runs the manual `stop:develop` / `stop:production` job, which
  removes the container (`docker rm -f mcp-metexplore`).
- **Re-deploy**: re-runs the deploy job of the last deployment (same image tag),
  which restarts the service after a stop. A rollback is a re-deploy of an older
  deployment.

CI/CD variables. The SSH credentials are shared with other projects and
defined at the **group** level, without environment scope:

| Variable | Notes |
|---|---|
| `SSH_USER` | SSH user on the VMs (must be allowed to run `docker`) |
| `SSH_PRIVATE_KEY` | Key authorized for `SSH_USER` (File or Variable type) |
| `SSH_HOST_TEST_SERVER` | Develop VM (used as `DEPLOY_HOST` by `deploy:develop`) |
| `SSH_HOST_PROD_SERVER` | Production VM (used as `DEPLOY_HOST` by `deploy:production`) |
| `SSH_KNOWN_HOSTS` | `ssh-keyscan` output of both VMs (can also be defined at project level) |

Everything else is defined at the **project** level (Settings > CI/CD >
Variables), **scoped to the `develop` and `production` environments**, so it
never affects other projects of the group. A project-level variable also
overrides a group-level one with the same name (e.g. a different `SSH_USER`
for one environment).

| Variable | Notes |
|---|---|
| `METEXPLORE_API_URL` | MetExplore API used by this environment |
| `METEXPLORE_APP_KEY` | Masked + protected |
| `MCP_ALLOWED_HOSTS` | Public hostname of this environment |
| `HOST_PORT` | Optional (default `8077`), bound to `127.0.0.1` on the VM |
| `METEXPLORE_MAX_REQUESTS_PER_SESSION`, `METEXPLORE_TLS_REJECT_UNAUTHORIZED`, `MCP_RATE_LIMIT_PER_MINUTE`, `MCP_MAX_SESSIONS`, `MCP_SESSION_TTL_MINUTES` | Optional |

The npm token is defined at the project level, **without** environment scope:

| Variable | Notes |
|---|---|
| `NPM_TOKEN` | Masked + protected. npm *granular access token* (npmjs.com > Access Tokens > Generate New Token > Granular): read and write on the `@metexplore` organization, **"Bypass two-factor authentication"** checked (publishing from the CI cannot answer an OTP). Write tokens expire after 90 days at most: rotate it before expiry, or `publish:npm` fails |

Protected variables are only exposed on protected branches/tags: protect
`develop` and the release tags `*.*.*` (Settings > Repository).

### Known limitations

- HTTP sessions are kept in memory: a single container instance is assumed
  (no horizontal scaling without sticky sessions), and a restart closes all
  sessions (clients transparently re-initialize).
- The quota is per MCP session; the per-IP rate limit is what bounds a client
  opening many sessions.
- `GET /networks` and `GET /metabolites` don't support server-side filtering
  by name: searching happens client-side over the full (cached) list. For a
  very large network, the first metabolite search can be sizeable.

## Contributing

We welcome contributions!
Please open an issue or a merge request on the
[forge repository](https://forge.inrae.fr/metexplore/mcp/mcp-metexplore).

### Development Guidelines

```bash
npm run dev    # TypeScript compilation in watch mode
npm test       # unit tests (node:test, mocked fetch)
```

`npm run dev` only recompiles `dist/`; it does not start the server.

#### Testing with an LLM client (Claude Code)

1. Terminal 1, recompile on change:

   ```bash
   npm run dev
   ```

2. Terminal 2, start the server in HTTP mode:

   ```bash
   MCP_TRANSPORT=http npm start
   ```

   (listens on `http://127.0.0.1:3000/mcp`; configure `METEXPLORE_API_URL`
   in `.env`, e.g. `http://localhost:1337`)

3. Connect Claude Code:

   ```bash
   claude mcp add --transport http --scope local metexplore-dev http://127.0.0.1:3000/mcp
   ```

   Check the connection with `/mcp`, then ask a test question.

The server does not reload on change: restart it after each rebuild.
Remove the test entry with `claude mcp remove metexplore-dev`.

#### Testing with the MCP Inspector

```bash
npx @modelcontextprotocol/inspector
# connect to http://localhost:3000/mcp with the "Streamable HTTP" transport
# (server started as above)
```

Put test configuration in `.env` rather than in shell `VAR=value` prefixes:
the server reads it via `dotenv`, and the inspector's `--cli` mode does not
forward the shell's custom environment variables.

### Code Style

- TypeScript (strict mode), ES modules
- Tool inputs are validated with [Zod](https://zod.dev/)

## Changelog

All notable changes to this project will be documented in [CHANGELOG.md](CHANGELOG.md).
For the versions available, see the [releases on this repository](https://forge.inrae.fr/metexplore/mcp/mcp-metexplore/-/releases).

## Authors

- **Ludovic Cottret** - *Design, prompting, and reviewing* - MTH, INRAE, MetaToul
- **Claude code** - *Code generation* - claude-opus-5-5 model

## License

**mcp-metexplore** is distributed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
Please refer to [LICENSE](LICENSE) file for further details.

## Support &amp; External resources

- :book: **MetExplore API documentation** - [MetExplore API](https://metexplore.pages-forge.inrae.fr/metexplore-api/metexplore3-nodejs-api/)
- :scroll: **MCP specification** - [Model Context Protocol](https://modelcontextprotocol.io/)
- :bug: **Bug Reports** - [Forge issues](https://forge.inrae.fr/metexplore/mcp/mcp-metexplore/-/issues)
- :email: **Email** - <contact-metexplore@inrae.fr>

## Acknowledgments

- Built with the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- Relies on the [MetExplore](https://metexplore.toulouse.inrae.fr) web server and API
- Supported by [MetaboHUB](https://www.metabohub.fr)

## Additional Resources

- [MetExplore website](https://metexplore.toulouse.inrae.fr)

---
