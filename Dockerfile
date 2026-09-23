# ---- ビルドステージ ----
FROM node:24-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- 実行ステージ ----
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/data/graph.json ./data/graph.json
COPY --from=builder /app/data/fare-rules ./data/fare-rules
COPY --from=builder /app/data/fare-overrides ./data/fare-overrides

EXPOSE 3000

CMD ["node", "server.js"]
