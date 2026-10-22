# Multi-target build: `--target web` and `--target worker`.
FROM node:22-alpine AS base
RUN corepack enable pnpm
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
# Filtered to the two apps that ship. The workspace also holds the documentation
# site, whose MDX, syntax-highlighting and search toolchain would otherwise land
# in both runtime images for no reason: it is a separate deployment and is never
# served from here.
RUN pnpm install --frozen-lockfile \
      --filter "@deskbell/web..." \
      --filter "@deskbell/worker..."
# The Weaviate client is a root dependency so that DESKBELL_VECTOR_STORE=weaviate
# works in both images with no extra install (spec: weaviate-vector-store):
# root node_modules is on every package's resolution path, which is what the
# engine's optional import needs. Pure JavaScript, no native code. This line
# fails the build the day the package stops being here.
RUN node -e "import('weaviate-client')"

FROM deps AS build
# The widget bundle the web app serves at /deskbell.js. Turbo orders it before
# the app through ^build; a plain filtered build does not, and an image without
# it answers every script tag with a 503.
RUN pnpm --filter @deskbell/widget-snippet build
RUN pnpm --filter @deskbell/web build

# --- web: full-deps image running `next start` (reliable with pnpm monorepo).
# Slimming via standalone output is a follow-up: TODO(spec: web-image-slim) —
# Next's file tracing currently drops @swc/helpers subpaths under pnpm. ---
FROM build AS web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@deskbell/web", "start"]

# --- worker: runs TS directly via tsx (build step lands with spec: worker-build) ---
FROM deps AS worker
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@deskbell/worker", "start"]
