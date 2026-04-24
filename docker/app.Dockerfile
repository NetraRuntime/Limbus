# syntax=docker/dockerfile:1.7
# Stage 1 — build the canvas app's Vite bundle (the web debug build that
# the Tauri desktop wraps in production).
FROM node:20-alpine AS build

# pnpm via corepack — pinned in root package.json's "packageManager" field.
RUN corepack enable

WORKDIR /repo

# Copy the root workspace manifest and lockfile first so install-step
# caching invalidates only on dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Copy each workspace package's manifest — pnpm needs them to resolve
# the dependency graph before it has the source.
COPY packages/design-system/package.json ./packages/design-system/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY apps/app/package.json ./apps/app/

RUN pnpm install --frozen-lockfile --filter @netrart/app...

# Copy source for the app build (app + its workspace deps).
COPY packages/design-system ./packages/design-system
COPY packages/tsconfig ./packages/tsconfig
COPY apps/app ./apps/app

# Build with a relative API base so the bundle talks to whatever origin
# serves it — nginx will reverse-proxy /api and /_/ to the PB container.
ENV VITE_PB_URL=""
RUN pnpm --filter @netrart/app build

# Stage 2 — serve static assets + proxy to PocketBase via nginx.
FROM nginx:1.27-alpine

COPY --from=build /repo/apps/app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
