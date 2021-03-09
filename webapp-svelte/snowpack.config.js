require("dotenv/config");
const httpProxy = require("http-proxy");

const remote = process.env.backend === "remote";

console.log(process.env.backend, "back");

const proxy = httpProxy.createServer({
  target: remote ? "https://www.boardgamers.space" : "http://localhost:50801",
  changeOrigin: true,
});
const proxyWs = remote ? proxy : httpProxy.createServer({ target: "http://localhost:50802" });
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

proxy.on("upgrade", function (req, socket, head) {
  proxy.ws(req, socket, head);
});
proxyWs.on("upgrade", function (req, socket, head) {
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
    "@lib": "../site-lib",
  },
  routes: [
    /* Enable an SPA Fallback in development: */
    // {"match": "routes", "src": ".*", "dest": "/index.html"},
    {
      src: "/ws",
      dest: (req, res) => proxyWs.web(req, res),
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
      src: "resources.localhost",
      dest: (req, res) => proxyResources.web(req, res),
    },
  ],
  optimize: {
    /* Example: Bundle your final build: */
    // "bundle": true,
  },
  packageOptions: {
    /* ... */
  },
  devOptions: {
    /* ... */
  },
  buildOptions: {
    /* ... */
  },
};
