# aisstream recorder for /ships — see recorder.mjs and docs/AISSTREAM_RECORDER_PLAN.md. Build context: this folder.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages duckdb==1.4.4 \
 && apt-get purge -y python3-pip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY recorder.mjs compact.py daypack.py ./
COPY sources ./sources
ENV DATA_DIR=/data NODE_ENV=production
CMD ["node", "recorder.mjs"]
