FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production \
    VAULT_PATH=/vault \
    OUTPUT_PATH=/output \
    RULES_CONFIG=/config/rules.json \
    LOG_LEVEL=info \
    DEBOUNCE_DELAY=300

VOLUME ["/vault", "/output", "/config"]

CMD ["node", "dist/main.js"]
