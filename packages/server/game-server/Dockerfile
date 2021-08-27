# You need to build from the parent directory 
FROM node:14

RUN npm install -g pnpm

WORKDIR /usr/src/app

COPY ./packages/server/game-server/package.json ./packages/server/game-server/
COPY ./packages/server/game-server/pnpm-lock.yaml ./packages/server/game-server/
COPY .nmprc ./
COPY .pnpm-workspace.yaml ./

RUN pnpm install --filter game-server...

COPY ./packages/shared ./packages/shared
COPY ./packages/server/game-server ./packages/server/game-server

EXPOSE 50803

WORKDIR /usr/src/app/packages/server/game-server

CMD ["pnpm", "start"]