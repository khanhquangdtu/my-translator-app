# The app, as a self-contained image.
#
# Three stages so the runtime carries neither the toolchain nor the dev
# dependencies: install, build, then copy only Next's `standalone` output.
#
# Nothing secret is baked in. `SONIOX_API_KEY`, `OPENAI_API_KEY` and
# `MONGODB_URI` are read at runtime from the environment — see
# `docker-compose.yml`. The one value that *must* be present at build time is
# `NEXT_PUBLIC_MOCK_ENGINE`, because `NEXT_PUBLIC_*` is inlined into the browser
# bundle by definition; that is also exactly why no provider key may ever wear
# that prefix.

# ─── deps ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Copied on their own so this layer is only rebuilt when the lockfile moves,
# not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

# ─── build ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Off by default: an image built with the mock engine on cannot translate
# anything, and that failure would be silent.
ARG NEXT_PUBLIC_MOCK_ENGINE=""
ENV NEXT_PUBLIC_MOCK_ENGINE=$NEXT_PUBLIC_MOCK_ENGINE

ENV NEXT_TELEMETRY_DISABLED=1
# Runs typecheck and lint as part of `next build`, so a broken image fails here
# rather than at `docker compose up`.
RUN npm run build

# ─── runtime ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Without this the server binds to localhost inside the container and nothing
# outside it can reach the port.
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# `standalone` carries the server and its real dependency closure, but not
# these two: static assets and everything under public/ are copied separately.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# /api/config is the cheapest honest liveness probe: it touches no provider and
# no database, and answering it at all means the server is up.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
