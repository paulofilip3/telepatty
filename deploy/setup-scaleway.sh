#!/bin/bash
# Setup script for Scaleway server (tty.paulorosario.com)
# Run once on the Scaleway box to configure nginx + certbot
set -euo pipefail

DOMAIN="tty.paulorosario.com"

echo "==> Installing nginx and certbot..."
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> Creating nginx config..."
cp nginx.conf "/etc/nginx/sites-available/${DOMAIN}"
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"

echo "==> Testing nginx config..."
nginx -t

echo "==> Obtaining SSL certificate..."
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --email paulo@interpt.co

echo "==> Reloading nginx..."
systemctl reload nginx

echo "==> Done! Make sure DNS A record for ${DOMAIN} points to this server's IP."
echo "    Then start the SSH tunnel from your workstation."
