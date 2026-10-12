#!/usr/bin/env bash
#
# start-frontend.sh
# Starts the EPICS PV Plotter frontend (Vite dev server).
# Can be run manually for testing, or invoked by systemd.
#

set -e   # Exit on error

# ------------------------------------------------------------
# 1. load nvm（important: let node/npm available）
# ------------------------------------------------------------
export NVM_DIR="/home/b_bluesky/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

# use the correct version of  node （ which node ）
nvm use v20.11.1 >/dev/null 2>&1 || true

# add node bin to PATH
export PATH="/home/b_bluesky/.nvm/versions/node/v20.11.1/bin:$PATH"

# ------------------------------------------------------------
# 2. get into main directory
# ------------------------------------------------------------
cd /home/b_bluesky/Documents/epics-pv-plotter

# ------------------------------------------------------------
# 3. print out details
# ------------------------------------------------------------
echo "=========================================="
echo " Starting EPICS PV Plotter Frontend"
echo " node: $(which node)  ($(node -v))"
echo " npm : $(which npm)   ($(npm -v))"
echo " cwd : $(pwd)"
echo "=========================================="

# ------------------------------------------------------------
# 4. Start Vite dev server
#    exec let npm process shell，used for  systemd to manage ongoing processes
# ------------------------------------------------------------
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5175}"
exec npm run dev -- --host "$HOST" --port "$PORT"
