FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

COPY package*.json ./
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist

ENV NODE_ENV=production \
    HOME=/home/node \
    VAULT_PATH=/vault \
    OUTPUT_PATH=/output \
    RULES_CONFIG=/config/rules.json \
    ONEDRIVE_FOLDER=ObsidianPublished \
    LOG_LEVEL=info \
    DEBOUNCE_DELAY=300

RUN mkdir -p /home/node/.obsidian-sync /output \
    && chown -R node:node /home/node/.obsidian-sync /output

VOLUME ["/vault", "/output", "/config", "/home/node/.obsidian-sync"]

EXPOSE 8080

USER node

CMD ["node", "dist/main.js", "--sync", "--watch"]
