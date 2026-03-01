import { LockManager } from "mongo-locks";

let manager: LockManager;

const noop = async () => {};

function init(collection: ConstructorParameters<typeof LockManager>[0]) {
  manager = new LockManager(collection);
}

async function lock(...keys: unknown[]): Promise<() => Promise<void>> {
  const key = keys.join(":");
  const result = await manager.lock(key);
  if (!result) {
    return noop;
  }
  return () => result.free().then(() => {});
}

export default { init, lock, noop };
