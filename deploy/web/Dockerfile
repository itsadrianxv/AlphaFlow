FROM node:20-bookworm-slim

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .

ARG SKIP_ENV_VALIDATION=1
ENV SKIP_ENV_VALIDATION=${SKIP_ENV_VALIDATION}

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
