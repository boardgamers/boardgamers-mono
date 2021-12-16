module.exports = {
  apps: [
    {
      name: "web",
      script: "./index.js",
      cwd: "./apps/web/build",
      env: {
        HOST: "127.0.0.1",
        PORT: 8612,
      },
    },
    {
      name: "game-server",
      script: "npm",
      cwd: "./apps/game-server",
      args: "start",
    },
    {
      name: "api",
      script: "npm",
      cwd: "./apps/api",
      args: "start",
    },
  ],
};
