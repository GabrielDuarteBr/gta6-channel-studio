# syntax=docker/dockerfile:1.7
# Imagens Node do Radar Neon (multi-alvo): web, agents, render, ci e e2e.
# Mesmo arquivo no notebook (docker-compose.yml) e na VPS (imagens do GHCR).

ARG NODE_IMAGE=node:22-bookworm-slim
ARG UBUNTU_IMAGE=ubuntu:24.04
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.65.0-noble
ARG PNPM_VERSION=10.28.0

# ---------------------------------------------------------------- node-bin
FROM ${NODE_IMAGE} AS node-bin

# ---------------------------------------------------------------- os-base
# Ubuntu 24.04 (o mesmo SO da VPS) com o Node oficial copiado e OpenSSL
# (exigido pelo motor de migrations do Prisma).
FROM ${UBUNTU_IMAGE} AS os-base
ENV DEBIAN_FRONTEND=noninteractive TZ=America/Sao_Paulo
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata openssl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node-bin /usr/local/bin/node /usr/local/bin/node
COPY --from=node-bin /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY infra/docker/with-ca.sh /usr/local/bin/with-ca

# ---------------------------------------------------------------- base (build)
FROM os-base AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=extra_ca,required=false \
    with-ca npm install -g pnpm@${PNPM_VERSION} && pnpm config set store-dir /pnpm/store
WORKDIR /app

# ---------------------------------------------------------------- deps (camada cacheável)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/agents/package.json apps/agents/
COPY apps/render/package.json apps/render/
COPY packages/shared/package.json packages/shared/
COPY packages/policy/package.json packages/policy/
COPY packages/db/package.json packages/db/
COPY packages/queue/package.json packages/queue/
COPY packages/research/package.json packages/research/
COPY packages/llm/package.json packages/llm/
COPY e2e/package.json e2e/
RUN --mount=type=secret,id=extra_ca,required=false \
    --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    with-ca pnpm install --frozen-lockfile

# ---------------------------------------------------------------- source
FROM deps AS source
COPY . .
RUN pnpm --filter @studio/db generate

# ---------------------------------------------------------------- ci (lint, tipos, testes)
FROM source AS ci
CMD ["sh", "-c", "pnpm lint && pnpm turbo run typecheck test --concurrency=2 && pnpm check:forbidden"]

# ---------------------------------------------------------------- web-build
FROM source AS web-build
RUN pnpm --filter @studio/web build

# ---------------------------------------------------------------- web (runtime)
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=America/Sao_Paulo
WORKDIR /app
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ---------------------------------------------------------------- app-prod (só dependências de produção)
FROM source AS app-prod
RUN --mount=type=secret,id=extra_ca,required=false \
    --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    with-ca pnpm install --frozen-lockfile --prod \
 && rm -rf apps/web e2e

# ---------------------------------------------------------------- agents (runtime)
FROM os-base AS agents
ENV NODE_ENV=production PORT=4100
RUN useradd --create-home --uid 1001 agents
COPY --from=app-prod --chown=agents:agents /app /app
WORKDIR /app/apps/agents
USER agents
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/index.ts"]

# ---------------------------------------------------------------- render (runtime: Chrome headless + Remotion)
FROM os-base AS render
ENV NODE_ENV=production PORT=4200
# Dependências do Chrome Headless Shell (documentação do Remotion) + fontes.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 libpango-1.0-0 \
      libcairo2 libxshmfence1 \
      fonts-noto-core fonts-noto-color-emoji fonts-liberation2 \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 1001 render
COPY --from=app-prod --chown=render:render /app /app
WORKDIR /app/apps/render
USER render
# Baixa o Chrome Headless Shell compatível com esta versão do Remotion.
RUN --mount=type=secret,id=extra_ca,required=false,uid=1001 \
    with-ca node_modules/.bin/remotion browser ensure
EXPOSE 4200
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4200/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/server.ts"]

# ---------------------------------------------------------------- e2e (Playwright com navegadores)
FROM ${PLAYWRIGHT_IMAGE} AS e2e
ARG PNPM_VERSION
ENV CI=true
COPY infra/docker/with-ca.sh /usr/local/bin/with-ca
RUN --mount=type=secret,id=extra_ca,required=false \
    with-ca npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY e2e/package.json e2e/
RUN --mount=type=secret,id=extra_ca,required=false \
    with-ca pnpm install --frozen-lockfile --filter @studio/e2e
COPY e2e e2e
WORKDIR /app/e2e
CMD ["pnpm", "exec", "playwright", "test", "--trace", "off"]
