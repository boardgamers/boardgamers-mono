module.exports = {
  devServer: {
    proxy: {
      "/api/gameplay": {
        target: process.env.backend === "remote" ? "https://www.boardgamers.space/" : "http://localhost:50803/",
      },
      "/api": {
        target: process.env.backend === "remote" ? "https://www.boardgamers.space/" : "http://localhost:50801/",
      },
    },
    port: "8613",
    // For gitpod, it needs to be disabled
    disableHostCheck: true,
  },
  transpileDependencies: ["vuetify"],
};
