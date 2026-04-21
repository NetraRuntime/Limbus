# syntax=docker/dockerfile:1.7
# PocketBase runtime. The binary is fetched per-arch at build time so the
# same Dockerfile produces amd64 and arm64 images without pulling a cross-
# compiled layer from elsewhere.
FROM alpine:3.20 AS base

ARG PB_VERSION=0.37.2
ARG TARGETARCH

RUN apk add --no-cache ca-certificates unzip wget \
 && mkdir -p /pb \
 && wget -qO /tmp/pb.zip \
      "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" \
 && unzip -q /tmp/pb.zip -d /pb \
 && rm /tmp/pb.zip /pb/CHANGELOG.md /pb/LICENSE.md \
 && chmod +x /pb/pocketbase \
 && apk del unzip

# Migrations ship with the image so a fresh volume bootstraps the schema
# on first run.
COPY pb/pb_migrations /pb/pb_migrations

WORKDIR /pb
EXPOSE 8090

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8090/api/health | grep -q '"code":200' || exit 1

# --dir and --migrationsDir are explicit so default resolution (relative to
# cwd) can't drift if the working dir changes.
CMD ["./pocketbase", "serve", \
     "--http=0.0.0.0:8090", \
     "--dir=/pb/pb_data", \
     "--migrationsDir=/pb/pb_migrations"]
