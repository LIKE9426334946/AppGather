#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

if [[ -f "${DATA_DIR:-backend/data}/credentials.json" ]]; then
  node backend/credentials.js --check
else
  if [[ ! -t 0 ]]; then
    printf '首次部署请在终端运行 bash deploy/setup-auth.sh，设置 noart 的登录密码。\n' >&2
    exit 1
  fi
  read -r -s -p '请输入 noart 的登录密码（输入不显示）: ' APPGATHER_INITIAL_PASSWORD
  printf '\n'
  printf '%s' "$APPGATHER_INITIAL_PASSWORD" | node backend/credentials.js
  unset APPGATHER_INITIAL_PASSWORD
fi
