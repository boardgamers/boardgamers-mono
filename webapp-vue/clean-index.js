const fs = require("fs");

const content = fs.readFileSync("dist/index.html").toString("utf-8");

// Remove favicons added by vue-cli-plugin/pwa. I wish there was a better way
fs.writeFileSync("dist/index.html", content.replace(/<link rel=icon [^>]+>/g, ""));
