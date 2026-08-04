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
			interpreter: NODE,
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
			interpreter: NODE,
			node_args: ["--env-file-if-exists=.env", "--env-file-if-exists=.env.production"],
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
			node_args: ["--env-file-if-exists=.env", "--env-file-if-exists=.env.production"],
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
			interpreter: NODE,
			node_args: ["--env-file-if-exists=.env", "--env-file-if-exists=.env.production"],
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
			node_args: ["--env-file-if-exists=.env", "--env-file-if-exists=.env.production"],
		},
	],
};
