module.exports = {
  lintOnSave: false,

  // For development with vue hot reloading, contact correct backend
  devServer: {
    // For gitpod, it needs to be disabled
    disableHostCheck: true,
    proxy: {
      "/ws": {
        target: process.env.backend === "remote" ? "https://www.boardgamers.space" : "http://localhost:50802/",
        ws: true,
      },
      "/api/gameplay": {
        target: process.env.backend === "remote" ? "https://www.boardgamers.space" : "http://localhost:50803/",
      },
      "/api": {
        target: process.env.backend === "remote" ? "https://www.boardgamers.space" : "http://localhost:50801/",
      },
      "/resources": {
        target: process.env.backend === "remote" ? "https://resources.boardgamers.space" : "http://localhost:50804",
        pathRewrite: { "^/resources": "" },
      },
    },
  },

  chainWebpack: (config) => {
    config.plugin("define").tap((args) => {
      let v = JSON.stringify(require("./package.json").version);
      args[0]["process.env"]["VERSION"] = v;
      return args;
    });
  },
};
