# You need to build from the mono repo root directory 
FROM node:24-slim

RUN npm install -g pnpm

WORKDIR /usr/src/app

COPY ./apps/api/package.json ./apps/api/
COPY .npmrc ./
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

RUN pnpm install --filter @bgs/api...

COPY ./packages ./packages
COPY ./apps/api ./apps/api

# API
EXPOSE 50801
# WEBSOCKET
EXPOSE 50802
# RESOURCES
EXPOSE 50804

WORKDIR /usr/src/app/apps/api

CMD ["pnpm", "start"]
