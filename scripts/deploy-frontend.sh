#!/usr/bin/env bash
#
# deploy-frontend.sh
# Builds the production frontend and publishes it to the path nginx
# serves (/var/www/epics-pv-plotter). Run this after pulling changes
# that touch the frontend.
#
# Requires sudo for the copy step, since /var/www is outside the
# repo owner's home directory (nginx's www-data user can't traverse
# into the home directory to serve the build in place).

set -e

cd "$(dirname "$0")/.."

echo "Building frontend..."
npm run build

echo "Publishing dist/ to /var/www/epics-pv-plotter ..."
sudo mkdir -p /var/www/epics-pv-plotter
sudo rsync -a --delete dist/ /var/www/epics-pv-plotter/

echo "Done. If this is the first deploy, also install the nginx site:"
echo "  sudo cp gateway/nginx-epics-pv-plotter.conf /etc/nginx/sites-available/epics-pv-plotter"
echo "  sudo ln -sf /etc/nginx/sites-available/epics-pv-plotter /etc/nginx/sites-enabled/"
echo "  sudo rm -f /etc/nginx/sites-enabled/default"
echo "  sudo nginx -t && sudo systemctl reload nginx"
