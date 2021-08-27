const autoPreprocess = require("svelte-preprocess");

module.exports = {
  preprocess: autoPreprocess({
    defaults: {
      script: "typescript",
      style: "postcss",
    },
    postcss: {
      plugins: [require("postcss-nested")],
    },
  }),
};
