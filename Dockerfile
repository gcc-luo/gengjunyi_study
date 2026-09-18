ARG DOCKERHUB_PREFIX=docker.io

FROM ${DOCKERHUB_PREFIX}/library/node:22-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run server:build

FROM ${DOCKERHUB_PREFIX}/library/node:22-bookworm-slim AS api-runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/src/generated/prisma ./server/src/generated/prisma
COPY --from=builder /app/server/prisma ./server/prisma
COPY --from=builder /app/server/prisma.config.ts ./server/prisma.config.ts
USER node
EXPOSE 3000
CMD ["node", "server/dist/index.js"]

FROM ${DOCKERHUB_PREFIX}/library/nginx:alpine AS web-runtime
COPY ops/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
