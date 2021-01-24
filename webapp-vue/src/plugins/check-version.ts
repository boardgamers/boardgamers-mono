import axios from "axios";
import store from "../store";

async function needsUpdate(): Promise<boolean> {
  const { data: remote } = await axios.get("/index.html?t=" + Date.now());

  const linkUrl = /=["']?(\/js)?\/app\.[^ "'>]*/;

  let remoteMatch = remote.match(linkUrl)[0];

  while (remoteMatch[0] === "'" || remoteMatch[0] === "=" || remoteMatch[0] === '"') {
    remoteMatch = remoteMatch.slice(1);
  }

  if (!remoteMatch) {
    return false;
  }

  for (const link of document.getElementsByTagName("link")) {
    if (link.getAttribute("href") === remoteMatch) {
      console.log("version matching, no need to reload");
      return false;
    }
  }

  console.log("no link with url", remoteMatch);

  return true;
}

const updateIfNeeded = async () => {
  if (!store.state.updateAvailable && (await needsUpdate())) {
    store.commit("updateAvailable");
  }
};

setTimeout(async () => {
  await updateIfNeeded();

  setInterval(updateIfNeeded, 2 * 60 * 1000);
}, 5000);
