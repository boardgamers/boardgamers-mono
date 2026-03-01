# You need to build from the mono repo root directory 
FROM node:24-slim

RUN npm install -g pnpm

WORKDIR /usr/src/app

COPY ./apps/game-server/package.json ./apps/game-server/
COPY .npmrc ./
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

RUN pnpm install --filter @bgs/game-server...

COPY ./packages ./packages
COPY ./apps/game-server ./apps/game-server

EXPOSE 50803

WORKDIR /usr/src/app/apps/game-server

CMD ["pnpm", "start"]
