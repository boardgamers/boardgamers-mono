// Run every app under Node 24 (/usr/local/bin/node). api/game-server point straight at
// server.ts (Node ≥24 strips types) instead of going through `npm start` — otherwise PM2
// spawns npm with its default node (node18 at /usr/bin/node), ignoring the interpreter.
const NODE = "/usr/local/bin/node";

// Singleton work (cron, DB migrations, engine installs) is gated by env.cron, which
// defaults ON (so a single dev process runs everything). Each app therefore has:
//   - a clustered worker process (cron=false) that only serves traffic, and
//   - a dedicated fork process (cron=true, instances:1) that runs the singleton work.
// The singleton DB locks (apps/*/app/config/locks.ts) keep it exactly-once even during
// the brief overlap of a PM2 reload.
//
// Graceful shutdown: every app closes its HTTP/WS servers on SIGINT/SIGTERM and exits
// (api/game-server via gracefulShutdown in @bgs/utils/log, web via adapter-node).
// kill_timeout gives those closes time to finish before PM2 escalates to SIGKILL.

module.exports = {
	apps: [
		{
			name: "web",
			script: "./index.js",
			cwd: "./apps/web/build",
			env: {
				NODE_ENV: "production",
				HOST: "127.0.0.1",
				PORT: 8612,
			},
			exec_mode: "cluster",
			instances: 2,
			interpreter: NODE,
			kill_timeout: 10000,
			// No wait_ready: adapter-node handles SIGINT/SIGTERM itself but never sends the
			// PM2 "ready" signal, so wait_ready would stall its reloads.
		},
		{
			name: "game-server",
			script: "./server.ts",
			cwd: "./apps/game-server",
			env: {
				NODE_ENV: "production",
				cron: "false",
			},
			exec_mode: "cluster",
			instances: 2,
			interpreter: NODE,
			kill_timeout: 10000,
			wait_ready: true,
		},
		{
			name: "game-server-cron",
			script: "./server.ts",
			cwd: "./apps/game-server",
			env: {
				NODE_ENV: "production",
				cron: "true",
			},
			exec_mode: "fork",
			instances: 1,
			interpreter: NODE,
			kill_timeout: 10000,
			wait_ready: true,
		},
		{
			name: "api",
			script: "./server.ts",
			cwd: "./apps/api",
			env: {
				NODE_ENV: "production",
				cron: "false",
			},
			exec_mode: "cluster",
			instances: 2,
			interpreter: NODE,
			kill_timeout: 10000,
			wait_ready: true,
		},
		{
			name: "api-cron",
			script: "./server.ts",
			cwd: "./apps/api",
			env: {
				NODE_ENV: "production",
				cron: "true",
			},
			exec_mode: "fork",
			instances: 1,
			interpreter: NODE,
			kill_timeout: 10000,
			wait_ready: true,
		},
		{
			// Hang watchdog: polls game-server/api GET /health and `pm2 restart`s any app
			// that stops answering (event-loop wedge — PM2 alone only restarts on exit).
			// Runs under PM2 so the watchdog itself is supervised. See scripts/watchdog.ts
			// and infra/README.md#watchdog. Prod binds ::1, so set WATCHDOG_HOST=::1 there.
			name: "watchdog",
			script: "./scripts/watchdog.ts",
			cwd: "./apps/game-server",
			env: {
				NODE_ENV: "production",
			},
			exec_mode: "fork",
			instances: 1,
			interpreter: NODE,
			kill_timeout: 5000,
			// No wait_ready: the watchdog never sends the PM2 "ready" signal.
		},
	],
};
