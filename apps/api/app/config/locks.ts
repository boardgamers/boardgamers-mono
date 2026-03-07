import { LockManager } from "mongo-locks";

let manager: LockManager;

function init(collection: ConstructorParameters<typeof LockManager>[0]) {
  manager = new LockManager(collection);
}

async function lock(...keys: (string | number)[]) {
  const key = keys.join(":");
  return manager.lock(key);
}

export default { init, lock };
