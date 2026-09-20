#!/usr/bin/env bash
set -euo pipefail

cd /opt/AppGather

install -m 644 deploy/AppGather.service /etc/systemd/system/AppGather.service
install -m 644 deploy/AppGather.nginx /etc/nginx/sites-available/AppGather
ln -sfn /etc/nginx/sites-available/AppGather /etc/nginx/sites-enabled/AppGather

nginx -t
systemctl daemon-reload
systemctl enable AppGather
systemctl restart AppGather
systemctl enable --now nginx
systemctl reload nginx

curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 1 http://127.0.0.1:16050/api/health
printf '\nAppGather 已启动，访问 http://服务器IP:16050\n'
