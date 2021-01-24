# You need to build from the parent directory 
FROM node:14

RUN npm install -g pnpm

WORKDIR /usr/src/app

COPY ./game-server/package.json ./
COPY ./game-server/pnpm-lock.yaml ./

RUN pnpm install

COPY ./game-server .
COPY ./site-lib ../site-lib

EXPOSE 50803

CMD ["pnpm", "start"]