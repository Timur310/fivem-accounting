FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Build needs the dev dependencies (typescript), so install them separately
# rather than polluting the runtime node_modules above.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx tsc

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodejs
RUN apk add --no-cache wget
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
# Migrations are applied on startup by src/index.ts using the migrator bundled
# in drizzle-orm, so the SQL files must ship with the image. drizzle-kit itself
# is a devDependency and is deliberately absent here.
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package.json ./package.json
USER nodejs
EXPOSE 8000
CMD ["node", "dist/index.js"]
