#!/usr/bin/env bash
# instance-ip.sh — allocate a unique loopback IP for an isolated stack instance.
#
# Part of the multi-instance setup (see AGENTS.md "Running instances"): the
# coordinator gives each agent its own checkout under .worktrees/<name>/, and
# this script hands the agent a unique 127.1.X.Y IP (the whole 127.0.0.0/8
# block routes on Linux, no setup needed) so every instance can bind the
# DEFAULT ports (web 8612, api 50801, ws 50802, game-server 50803) on its own
# IP — no port arithmetic, no collisions.
#
# IPs are allocated from a machine-wide registry so two agents never get the
# same one, regardless of which checkout they run in. Allocation is
# file-locked and atomic.
#
# Usage:
#   scripts/instance-ip.sh alloc <name>   # → prints the IP (idempotent per name)
#   scripts/instance-ip.sh free <name>    # release the name's IP
#   scripts/instance-ip.sh list           # all allocations
#
# Env override: BGS_IP_REGISTRY (default ~/.bgs-instances/ips).
set -euo pipefail

REGISTRY="${BGS_IP_REGISTRY:-$HOME/.bgs-instances/ips}"
mkdir -p "$(dirname "$REGISTRY")"
touch "$REGISTRY"

die() { echo "instance-ip.sh: $*" >&2; exit 1; }

valid_name() { [[ "$1" =~ ^[a-z0-9][a-z0-9-]{0,23}$ ]] || die "invalid name '$1' (use [a-z0-9-], max 24 chars)"; }

# All commands funnel through one flock so concurrent agents can't race.
with_lock() {
	(
		flock -x 9
		"$@"
	) 9>"$REGISTRY.lock"
}

lookup() { awk -v n="$1" '$1 == n {print $2}' "$REGISTRY"; }

cmd_alloc() {
	local name="${1:?usage: instance-ip.sh alloc <name>}"
	valid_name "$name"
	with_lock _alloc "$name"
}
_alloc() {
	local name="$1" existing
	existing=$(lookup "$name")
	if [[ -n "$existing" ]]; then
		echo "$existing" # idempotent: same name always gets the same IP
		return
	fi
	# First free 127.1.X.Y: X in 2..254, Y in 2..254 (skip .0/.1/.255 and the
	# 127.1.1.x range — cheap insurance against anything else using low IPs).
	local x y ip
	for x in $(seq 2 254); do
		for y in $(seq 2 254); do
			ip="127.1.$x.$y"
			grep -q " $ip\$" "$REGISTRY" || { echo "$name $ip" >> "$REGISTRY"; echo "$ip"; return; }
		done
	done
	die "no free IPs in 127.1.0.0/16 (registry: $REGISTRY)"
}

cmd_free() {
	local name="${1:?usage: instance-ip.sh free <name>}"
	valid_name "$name"
	with_lock _free "$name"
}
_free() {
	local name="$1"
	grep -v "^$name " "$REGISTRY" > "$REGISTRY.tmp" || true
	mv "$REGISTRY.tmp" "$REGISTRY"
}

cmd_list() {
	if [[ -s "$REGISTRY" ]]; then
		awk '{printf "%-24s %s\n", $1, $2}' "$REGISTRY"
	else
		echo "no allocations (registry: $REGISTRY)"
	fi
}

case "${1:-}" in
	alloc) shift; cmd_alloc "$@" ;;
	free) shift; cmd_free "$@" ;;
	list) cmd_list ;;
	*) cat <<-EOF
		usage: scripts/instance-ip.sh <command>

		  alloc <name>   allocate (idempotently) a unique 127.1.X.Y loopback IP for <name>
		  free <name>    release the IP allocated to <name>
		  list           show all allocations (registry: $REGISTRY)
		EOF
		exit 1 ;;
esac
