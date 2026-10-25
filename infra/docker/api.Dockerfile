# syntax=docker/dockerfile:1
# Build context: repository root.  Multi-arch (built for linux/arm64 in CI).
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile --filter @bookstall/api...
RUN pnpm --filter @bookstall/shared build && pnpm --filter @bookstall/api build
RUN pnpm --filter @bookstall/api --prod --legacy deploy /out \
 && cp -r apps/api/dist /out/dist && cp -r apps/api/assets /out/assets

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production LOCAL_STORAGE_DIR=/data/storage
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN mkdir -p /data/storage && chown node:node /data/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://localhost:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini","--"]
# worker: node dist/worker.js   migrate: node dist/db/migrate.js   seed: node dist/db/seed.js
CMD ["node","dist/main.js"]
