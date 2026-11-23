FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY artifacts/plfe/package*.json ./
RUN npm ci --no-audit --no-fund
COPY artifacts/plfe/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home plfe
COPY --from=build --chown=plfe:plfe /app /app
RUN mkdir -p /app/var/uploads && chown -R plfe:plfe /app/var
USER plfe
EXPOSE 3000
CMD ["npm","start"]
