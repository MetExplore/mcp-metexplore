# mcp-metexplore

MCP (Model Context Protocol) server for querying the
[MetExplore API](https://metexplore.pages-forge.inrae.fr/metexplore-api/metexplore3-nodejs-api/)
from any MCP-compatible client (Claude Desktop, Claude Code, VS Code...).

It can run locally (`stdio` transport) or be deployed as a shared remote
server (Streamable HTTP transport, Docker image).

It exposes tools to:
- search for a MetExplore organism/network, with disambiguation when several
  networks match (e.g. "Homo sapiens");
- search for a metabolite in a network, with disambiguation (id, full name,
  chemical formula, cross-references);
- count/list the reactions involving a metabolite;
- map a list of metabolite identifiers onto a network and produce a report
  (mapped / not found / ambiguous);
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
| `METEXPLORE_USER_TOKEN` | no (stdio only) | A user token already obtained |
| `METEXPLORE_USER_LOGIN` / `METEXPLORE_USER_PASSWORD` | no (stdio only, set together) | Credentials used to call `/users/login` on first use |
| `METEXPLORE_MAX_REQUESTS_PER_SESSION` | no (default `20`) | Max number of requests sent to the API per MCP session |
| `METEXPLORE_TLS_REJECT_UNAUTHORIZED` | no (default `true`) | Set to `false` to disable TLS certificate verification (see "Known limitations") |
| `MCP_TRANSPORT` | no (default `stdio`) | `stdio` (local use) or `http` (remote deployment) |

Without any user credentials, the API is queried with the app key only: only
**public** networks are visible.

If `METEXPLORE_APP_KEY` is missing, the server refuses to start with an
explicit message instead of failing later with a confusing 401. Likewise, any
authentication error returned by the API (missing/invalid/expired app or user
token) is translated into a clear message stating what to check (`.env` in
stdio mode, the `X-MetExplore-Token` header in HTTP mode).

HTTP-mode variables are described in "Remote deployment (HTTP)" below.

## Using it with an MCP client (local, stdio)

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

## API request quota

To avoid overloading the MetExplore API, the server limits the number of HTTP
requests actually sent to `METEXPLORE_MAX_REQUESTS_PER_SESSION` (20 by
default) per MCP session: the whole process lifetime in stdio mode, one MCP
session (one client connection) in HTTP mode. An in-memory, per-session cache
(network list, metabolites per network) avoids re-spending this quota on
repeated searches over the same data. The remaining quota can be checked with
the `get_quota_status` tool. Once the quota is reached, restart the server
(stdio) or reconnect the client to open a new session (HTTP).

## Remote deployment (HTTP)

With `MCP_TRANSPORT=http`, the server exposes the MCP
[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http)
transport on `/mcp`, plus `GET /health` (used by the Docker healthcheck).

- **Authentication**: each client may send its own MetExplore user token in
  the `X-MetExplore-Token` header. Without it, the session is anonymous and
  only sees public networks. `METEXPLORE_USER_*` variables are ignored on the
  server in this mode; only `METEXPLORE_APP_KEY` is shared.
- **Isolation**: each MCP session gets its own API client, token, quota and
  cache. Tokens are kept in memory only and never logged.
- **Abuse protection**: per-IP rate limit, maximum number of concurrent
  sessions, idle sessions closed automatically.

| Variable | Default | Description |
|---|---|---|
| `MCP_HTTP_HOST` / `MCP_HTTP_PORT` | `127.0.0.1` / `3000` | Listening address (`0.0.0.0` in the Docker image) |
| `MCP_ALLOWED_HOSTS` | empty (no check) | Comma-separated public hostnames accepted in the `Host` header (DNS rebinding protection) |
| `MCP_TRUST_PROXY` | `false` | `true` behind a reverse proxy: client IP taken from `X-Forwarded-For` (set by the CI deployment) |
| `MCP_RATE_LIMIT_PER_MINUTE` | `60` | Max HTTP requests per client IP per minute on `/mcp` |
| `MCP_MAX_SESSIONS` | `200` | Max concurrent MCP sessions (503 beyond) |
| `MCP_SESSION_TTL_MINUTES` | `30` | Idle sessions are closed after this delay |

### Client configuration

Claude Code (`.mcp.json` or `claude mcp add --transport http ...`):

```json
{
  "mcpServers": {
    "metexplore": {
      "type": "http",
      "url": "https://<public-host>/mcp",
      "headers": { "X-MetExplore-Token": "<your MetExplore user token>" }
    }
  }
}
```

Omit `headers` to access public networks only.

### Docker

```bash
docker build -t mcp-metexplore .
docker run --rm -p 127.0.0.1:3000:3000 \
  -e METEXPLORE_APP_KEY=... -e METEXPLORE_API_URL=... \
  -e MCP_ALLOWED_HOSTS=localhost mcp-metexplore
curl http://localhost:3000/health
```

On the servers (see "Continuous deployment"), the container is
only bound to `127.0.0.1:${HOST_PORT}`; TLS and the public domain name are
handled by the host's reverse proxy, which must keep the original `Host`
header and should not buffer responses. Example (nginx):

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

Apache equivalent: `ProxyPreserveHost On`,
`ProxyPass /mcp http://127.0.0.1:3000/mcp flushpackets=on timeout=3600`.

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
| tag `vX.Y.Z` | `build:release`, `deploy:production` | `:vX.Y.Z`, `:latest` | environment `production` |

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
| `HOST_PORT` | Optional (default `3000`), bound to `127.0.0.1` on the VM |
| `METEXPLORE_MAX_REQUESTS_PER_SESSION`, `METEXPLORE_TLS_REJECT_UNAUTHORIZED`, `MCP_RATE_LIMIT_PER_MINUTE`, `MCP_MAX_SESSIONS`, `MCP_SESSION_TTL_MINUTES` | Optional |

Protected variables are only exposed on protected branches/tags: protect
`develop` and the `v*` tags (Settings > Repository).

## Development

```bash
npm run dev    # TypeScript compilation in watch mode
npm test       # unit tests (node:test, mocked fetch)
```

To test interactively against a local MetExplore instance
(`http://localhost:1337` by default):

```bash
npx @modelcontextprotocol/inspector node dist/index.js
# HTTP mode: start the server, then connect the inspector to
# http://localhost:3000/mcp with the "Streamable HTTP" transport
MCP_TRANSPORT=http node dist/index.js
```

Note: the inspector's `--cli` mode spawns the server without inheriting the
invoking shell's custom environment variables — put test configuration in
`.env` (read by the server itself via `dotenv`) rather than relying on
shell-level `VAR=value` prefixes when testing this way.

## Known limitations / next steps

- HTTP sessions are kept in memory: a single container instance is assumed
  (no horizontal scaling without sticky sessions), and a restart closes all
  sessions (clients transparently re-initialize).
- The quota is per MCP session; the per-IP rate limit is what bounds a client
  opening many sessions.
- `GET /networks` and `GET /metabolites` don't support server-side filtering
  by name: searching happens client-side over the full (cached) list. For a
  very large network, the first metabolite search can be sizeable.
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
