require("dotenv/config");
const httpProxy = require("http-proxy");

const remote = process.env.backend === "remote";

const proxy = httpProxy.createServer({
  target: remote ? "https://www.boardgamers.space" : "http://localhost:50801",
  changeOrigin: true,
});
const proxyWs = httpProxy.createServer({
  target: remote ? "https://www.boardgamers.space" : "http://localhost:50802",
  changeOrigin: true,
  ws: true,
});
const proxyGames = remote ? proxy : httpProxy.createServer({ target: "http://localhost:50803" });
const proxyResources = httpProxy.createServer({
  target: remote ? "https://resources.boardgamers.space" : "http://localhost:50804",
  changeOrigin: true,
});

proxy.on("proxyRes", function (proxyRes, req, res) {
  res.setHeader("Host", req.headers["host"]);
});
proxyResources.on("proxyRes", function (proxyRes, req, res) {
  res.setHeader("Host", req.headers["host"]);
});

proxyWs.on("upgrade", function (req, socket, head) {
  console.log("upgrated2");
  proxyWs.ws(req, socket, head);
});

/** @type {import("snowpack").SnowpackUserConfig } */
module.exports = {
  mount: {
    public: { url: "/", static: true },
    src: { url: "/dist" },
  },
  plugins: ["@snowpack/plugin-svelte", "@snowpack/plugin-dotenv", "@snowpack/plugin-typescript"],
  alias: {
    "@": "./src",
    "@cdk": "./src/modules/cdk",
    "@lib": "../site-lib",
  },
  routes: [
    {
      src: "/ws",
      dest: (req, res) => proxyWs.ws(req, res.socket),
    },
    {
      src: "/api/gameplay",
      dest: (req, res) => proxyGames.web(req, res),
    },
    {
      src: "/api/.*",
      dest: (req, res) => proxy.web(req, res),
    },
    {
      src: "/resources/.*",
      dest: (req, res) => {
        req.url = req.url.replace(/^\/resources/, "");
        proxyResources.web(req, res);
      },
    },
    /* Enable an SPA Fallback in development: */
    { match: "routes", src: ".*", dest: "/index.html" },
  ],
  ...(process.env.NODE_ENV === "production" && {
    optimize: {
      /* Example: Bundle your final build: */
      bundle: true,
      minify: true,
      target: "es2018",
    },
  }),
  packageOptions: {
    /* ... */
  },
  devOptions: {
    // Have to specify a different port so that websockets still work
    hmrPort: 5007,
    /* ... */
  },
  buildOptions: {
    /* ... */
  },
};
