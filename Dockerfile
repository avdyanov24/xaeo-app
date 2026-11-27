# syntax=docker/dockerfile:1

FROM node:26-alpine AS base
ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies first so this layer is cached between code changes.
# The npm cache stays in this stage; only node_modules is copied into the runtime image.
# mkdir keeps the copy valid while the app has no runtime dependencies.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir -p node_modules

FROM base AS runtime
ENV HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/xaeo.db
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# The SQLite file lives in /app/data; mount a volume there to keep it across containers.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/server/index.js"]
