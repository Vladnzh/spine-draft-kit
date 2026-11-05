ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN node build.mjs && node vendor.mjs \
 && mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    CHROME_PATH=/usr/bin/chromium

USER node
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "--input-type=module", "-e", "process.exit((await fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz')).ok ? 0 : 1)"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "serve.mjs"]
