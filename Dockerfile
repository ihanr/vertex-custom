# Build the custom WebUI from this checkout, never from upstream Git.
FROM node:22.16.0-bookworm-slim AS webui
WORKDIR /build/webui
COPY webui/package.json webui/package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY webui/ ./
COPY docker/build-webui.js /build/docker/build-webui.js
ARG VERTEX_REVISION=source-build
ENV VERTEX_DOCKER_BUILD=true VERTEX_REVISION=${VERTEX_REVISION}
RUN node /build/docker/build-webui.js

# Public runtime supplies Chromium, Redis, native Node modules and clean defaults.
# No pre-existing private/custom image or production configuration is required.
FROM lswl/vertex:2026.05.27
ARG VERTEX_REVISION=source-build
LABEL org.opencontainers.image.source="https://github.com/ihanr/vertex-custom" \
      org.opencontainers.image.revision="${VERTEX_REVISION}"
WORKDIR /app/vertex
COPY app/common/ app/common/
COPY app/controller/ app/controller/
COPY app/libs/ app/libs/
COPY app/model/ app/model/
COPY app/routes/ app/routes/
COPY app/app.js app/app.js
COPY docker/start.sh docker/healthcheck.js docker/
# Remove inherited UI so deleted upstream assets cannot remain in the custom UI.
RUN rm -rf /app/vertex/app/static \
 && node --check app/common/Rss.js \
 && node --check app/common/Client.js \
 && bash -n docker/start.sh \
 && test -s app/config_backup/sql.db \
 && test -s app/config_backup/setting.json \
 && node -e "const D=require('better-sqlite3');const d=new D(':memory:');if(d.pragma('quick_check',{simple:true})!=='ok')process.exit(1);d.close();require('./app/libs/backup');"
COPY --from=webui /build/app/static/ app/static/
EXPOSE 3000
CMD ["bash", "/app/vertex/docker/start.sh"]
