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

# root では動かさず、ベースイメージにある node ユーザー（uid 1000）で動かす。
# Next.js の with-docker の見本どおり、standalone 以下（Next が書き込む .next を含む）は node の持ち物にする。
# standalone には data/ も含まれるので data/ と data/fare-rules などのフォルダは node の持ち物になり、
# 下で上書きする JSON のファイルは root の持ち物になる（混在。アプリは実行中にファイルを書かない）。
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder /app/data/graph.json ./data/graph.json
COPY --from=builder /app/data/fare-rules ./data/fare-rules
COPY --from=builder /app/data/fare-overrides ./data/fare-overrides
COPY --from=builder /app/data/fare-zones.json ./data/fare-zones.json
COPY --from=builder /app/data/special-cities.json ./data/special-cities.json

USER node

EXPOSE 3000

CMD ["node", "server.js"]
