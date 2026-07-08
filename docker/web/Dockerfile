FROM node:20-bookworm-slim

WORKDIR /repo/web

ENV NEXT_TELEMETRY_DISABLED=1

RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends openssl; \
  rm -rf /var/lib/apt/lists/*

COPY web/package.json web/package-lock.json ./
COPY web/prisma ./prisma
RUN npm ci
COPY web ./

ARG SKIP_ENV_VALIDATION=1
ENV SKIP_ENV_VALIDATION=${SKIP_ENV_VALIDATION}

EXPOSE 3000

CMD ["npm", "run", "dev"]
