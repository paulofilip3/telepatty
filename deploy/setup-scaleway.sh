#!/bin/bash
# Setup script for the VPS reverse proxy
# Run once on the VPS to configure nginx + SSL
set -euo pipefail

DOMAIN="${1:?Usage: $0 <domain> [email]}"
EMAIL="${2:-admin@$DOMAIN}"

echo "==> Installing nginx..."
apt-get update
apt-get install -y nginx

echo "==> Creating self-signed origin cert..."
mkdir -p /etc/ssl/tty
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/ssl/tty/privkey.pem -out /etc/ssl/tty/fullchain.pem \
    -subj "/CN=${DOMAIN}"

echo "==> Creating nginx config..."
sed "s/tty.yourdomain.com/${DOMAIN}/g" nginx.conf > "/etc/nginx/sites-available/${DOMAIN}"
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"

echo "==> Testing nginx config..."
nginx -t

echo "==> Reloading nginx..."
systemctl reload nginx

echo "==> Done! Make sure:"
echo "    1. DNS A record for ${DOMAIN} points to this server's IP"
echo "    2. If using Cloudflare proxy, SSL mode is set to 'Full'"
echo "    3. Start the SSH tunnel from your workstation"
