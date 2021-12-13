# You need to build from the parent directory 
FROM node:14

RUN npm install -g pnpm

WORKDIR /usr/src/app

COPY ./apps/game-server/package.json ./apps/game-server/
COPY ./apps/game-server/pnpm-lock.yaml ./apps/game-server/
COPY .nmprc ./
COPY .pnpm-workspace.yaml ./

RUN pnpm install --filter @bgs/game-server...

COPY ./packages ./packages
COPY ./apps/game-server ./apps/game-server

EXPOSE 50803

WORKDIR /usr/src/app/apps/game-server

CMD ["pnpm", "start"]