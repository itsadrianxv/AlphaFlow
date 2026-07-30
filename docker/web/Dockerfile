FROM node:20-bookworm-slim

WORKDIR /repo/web

ENV NEXT_TELEMETRY_DISABLED=1

RUN set -eux; \
  find /etc/apt -type f \( -name '*.sources' -o -name '*.list' \) -print0 \
    | xargs -0 -r sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g'; \
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
