#!/usr/bin/env bash
# One-time / idempotent host setup for the minipc side of PR preview envs.
# Safe to re-run: every step is create-if-missing. Does NOT touch running envs.
#
#   ./setup-minipc.sh
set -euo pipefail

NETWORK="bgs-preview"
MONGO_CONTAINER="bgs-preview-mongo"
MONGO_DATA="$HOME/bgs-previews/mongo-data"
BIND="10.90.0.2" # WireGuard IP — the only address preview services listen on

# Isolated bridge shared by envs + mongo. Envs reach mongo by container name over
# this network; no allow_host_loopback, so envs can't touch host loopback services.
# Bridge NAT still gives outbound internet (engine npm installs).
if ! podman network exists "$NETWORK"; then
	echo "creating network $NETWORK"
	podman network create --driver bridge "$NETWORK"
fi

mkdir -p "$MONGO_DATA"

# Mongo holds every preview db. On the bridge so envs reach it by name; the
# WireGuard port publish stays so preview-api (host) can seed/inspect it.
if ! podman container exists "$MONGO_CONTAINER"; then
	echo "creating $MONGO_CONTAINER"
	podman run -d --name "$MONGO_CONTAINER" \
		--restart unless-stopped \
		--network "$NETWORK" \
		-p "$BIND:27017:27017" \
		-v "$MONGO_DATA:/data/db:Z" \
		docker.io/library/mongo:8 --bind_ip_all
fi

echo "ok: network=$NETWORK mongo=$MONGO_CONTAINER"
