# syntax=docker/dockerfile:1.7
# Stage 1 — build the website Vite bundle using pnpm workspace.
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
COPY apps/website/package.json ./apps/website/
COPY apps/app/package.json ./apps/app/

RUN pnpm install --frozen-lockfile --filter @netrart/website...

# Copy source for the website build (website + its workspace deps).
COPY packages/design-system ./packages/design-system
COPY packages/tsconfig ./packages/tsconfig
COPY apps/website ./apps/website

# Build with a relative API base so the bundle talks to whatever origin
# serves it — nginx will reverse-proxy /api and /_/ to the PB container.
ENV VITE_PB_URL=""
RUN pnpm --filter @netrart/website build

# Stage 2 — serve static assets + proxy to PocketBase via nginx.
FROM nginx:1.27-alpine

COPY --from=build /repo/apps/website/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
