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
COPY --from=builder /app/data/fare-zones.json ./data/fare-zones.json
COPY --from=builder /app/data/special-cities.json ./data/special-cities.json

EXPOSE 3000

CMD ["node", "server.js"]
