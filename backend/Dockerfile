FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Build needs devDependencies (TypeScript), so install them in a separate stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx tsc

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodejs
# tini reaps zombie processes that node leaves behind on signal handling,
# which would otherwise accumulate across deploys. wget powers HEALTHCHECK.
RUN apk add --no-cache tini wget

# Copy files with proper ownership assigned to non-root user.
# Build artefacts come from `builder`; production deps come from `deps` (which
# skipped devDependencies for a smaller image).
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./package.json
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules

USER nodejs
EXPOSE 8000

# Liveness probe — if /api/v1/health stops answering, the orchestrator
# restarts the container rather than leaving a hung process in service.
HEALTHCHECK CMD wget -qO- http://localhost:8000/api/v1/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
