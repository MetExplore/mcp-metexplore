# syntax=docker/dockerfile:1
# SPDX-License-Identifier: Apache-2.0

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Unit tests (used by the CI: docker build --target test .)
FROM deps AS test
COPY tsconfig.json tsconfig.test.json ./
COPY src ./src
COPY test ./test
RUN npm test

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
# Version reported by the server (the repository keeps 0.0.0; the CI passes the tag).
ARG VERSION=0.0.0
RUN npm pkg set version="$VERSION"
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${MCP_HTTP_PORT}/health" || exit 1
CMD ["node", "dist/index.js"]
