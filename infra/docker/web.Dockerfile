# syntax=docker/dockerfile:1
# Caddy is both the reverse proxy and the static file server for the web build.
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile --filter @bookstall/web...
ENV VITE_API_URL=/api/v1
RUN pnpm --filter @bookstall/shared build && pnpm --filter @bookstall/api-client build && pnpm --filter @bookstall/web build

FROM caddy:2-alpine
COPY --from=build /repo/apps/web/dist /srv
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
