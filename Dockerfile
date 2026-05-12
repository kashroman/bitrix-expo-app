# syntax=docker/dockerfile:1.7

# ---- builder ----------------------------------------------------------------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

ENV NODE_ENV=development \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# better-sqlite3 needs build toolchain when no prebuilt is available
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run check \
 && npm test \
 && npm run build

# Drop devDependencies for the runtime image
RUN npm prune --omit=dev

# ---- runtime ----------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# tini for proper signal handling and zombie reaping in container runtimes
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs --home /app --shell /usr/sbin/nologin nodejs

# Copy only what the production server needs:
#   - bundled server (dist/index.cjs)
#   - built client assets (dist/public/**)
#   - production node_modules (for externalised packages and native modules)
#   - package.json (so Node resolves "type": "module" / metadata correctly)
COPY --from=builder --chown=nodejs:nodejs /app/dist           ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules   ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json   ./package.json

USER nodejs

EXPOSE 8080

# Container runtimes (Yandex Serverless Containers, Cloud Run, etc.) inject
# PORT. The server reads process.env.PORT and binds 0.0.0.0.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.cjs"]
