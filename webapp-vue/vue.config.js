module.exports = {
  lintOnSave: false,
  pwa: {
    // Should only be enabled for IOS >= 11.3
    appleMobileWebAppCapable: "yes",
    appleMobileWebAppStatusBarStyle: "#16508f",
    // Settings should also be changed in public/manifest.json
    // name: 'The Pulsometer', // Also edit in public/index.html
    themeColor: "#16508f",
    // msTileColor: '#000000',
    name: "BGS",
  },

  // For development with vue hot reloading, contact correct backend
  devServer: {
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
