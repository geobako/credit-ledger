# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/lending-api/package.json apps/lending-api/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter lending-api...
COPY apps/lending-api apps/lending-api
RUN pnpm --filter lending-api build \
 && pnpm --filter lending-api deploy --prod --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/lending-api/dist ./dist
COPY db/migrations ./db/migrations
ENV MIGRATIONS_DIR=/app/db/migrations
# Amazon RDS CA bundle, so the cloud DATABASE_URL can use sslmode=verify-full
# (activated with NODE_EXTRA_CA_CERTS in the task definition; unused locally).
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
