import { confirm } from "@/utils";
import { get } from "./rest";

// Todo: import when snowpack supports hashed generated filenames

async function needsUpdate(): Promise<boolean> {
  const data = await get("/index.html?t=" + Date.now());

  const linkUrl = /=["']?(\/js)?\/app\.[^ "'>]*/;

  let remoteMatch = data.match(linkUrl)?.[0];

  if (!remoteMatch) {
    return false;
  }

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

let updateAvailable = false;
const updateIfNeeded = async () => {
  if (!updateAvailable && (await needsUpdate())) {
    updateAvailable = true;

    confirm("An update is available. Do you want to refresh?").then((res) => res && location.reload());
  }
};

setTimeout(async () => {
  await updateIfNeeded();

  setInterval(updateIfNeeded, 2 * 60 * 1000);
}, 5000);
