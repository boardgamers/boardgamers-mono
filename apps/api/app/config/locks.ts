import createError from "http-errors";
import { LockManager } from "mongo-locks";

let manager: LockManager;

function init(collection: ConstructorParameters<typeof LockManager>[0]) {
	manager = new LockManager(collection);
}

// Non-blocking: resolves to null when the key is already held. For work that can
// simply be skipped when contended (cron singletons) — callers check for null.
async function lock(...keys: (string | number)[]) {
	const key = keys.join(":");
	return manager.lock(key);
}

// Blocking acquisition for work that must actually serialize — game-state mutations
// on `game:<id>` (#280): polls until the holder releases. A held lock auto-refreshes
// its TTL every 10s (mongo-locks), so it survives long engine calls; the wait cap only
// matters when a holder crashed and its orphaned doc has to age out via the TTL
// monitor — better a retryable 423 than hanging the request for minutes.
const LOCK_WAIT_CAP_MS = 30_000;
const LOCK_POLL_MS = 100;

async function lockWait(...keys: (string | number)[]) {
	const key = keys.join(":");
	// Cap overridable via env (read per call so specs can flip it mid-run): the
	// 423-path specs would otherwise have to hold a lock for the full 30s.
	const capMs = Number(process.env.LOCK_WAIT_CAP_MS) || LOCK_WAIT_CAP_MS;
	const deadline = Date.now() + capMs;
	for (;;) {
		const acquired = await manager.lock(key);
		if (acquired) {
			return acquired;
		}
		if (Date.now() >= deadline) {
			throw createError(423, "Another operation on this resource is in progress, please retry");
		}
		await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
	}
}

export default { init, lock, lockWait };
