# You need to build from the parent directory 
FROM node:14

RUN npm install -g pnpm

WORKDIR /usr/src/app

COPY ./api-node/package.json ./
COPY ./api-node/pnpm-lock.yaml ./

RUN pnpm install

COPY ./api-node .
COPY ./site-lib ../site-lib

# API
EXPOSE 50801
# WEBSOCKET
EXPOSE 50802
# RESOURCES
EXPOSE 50804

CMD ["pnpm", "start"]