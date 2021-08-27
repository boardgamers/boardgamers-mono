# You need to build from the mono repo root directory 
FROM node:14

RUN npm install -g pnpm

WORKDIR /usr/src/app

COPY ./packages/server/api-node/package.json ./packages/server/api-node/
COPY ./packages/server/api-node/pnpm-lock.yaml ./packages/server/api-node/
COPY .nmprc ./
COPY .pnpm-workspace.yaml ./

RUN pnpm install --filter api-node...

COPY ./packages/shared ./packages/shared
COPY ./packages/server/api-node ./packages/server/api-node

# API
EXPOSE 50801
# WEBSOCKET
EXPOSE 50802
# RESOURCES
EXPOSE 50804

WORKDIR /usr/src/app/packages/server/api-node

CMD ["pnpm", "start"]