# syntax=docker/dockerfile:1.7
# Stage 1 — build the Vite bundle.
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# Build with a relative API base so the bundle talks to whatever origin
# serves it — nginx will reverse-proxy /api and /_/ to the PB container.
ENV VITE_PB_URL=""
RUN npm run build

# Stage 2 — serve static assets + proxy to PocketBase via nginx.
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
