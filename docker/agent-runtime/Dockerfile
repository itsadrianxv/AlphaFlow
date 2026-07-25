FROM node:22.19-bookworm-slim

WORKDIR /repo/agent_runtime

ENV NODE_ENV=development

COPY agent_runtime/package.json agent_runtime/package-lock.json ./
RUN npm ci

EXPOSE 8020

CMD ["npm", "run", "dev"]
