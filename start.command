#!/bin/zsh
# LocalLens 启动器：在本机起一个静态服务并打开浏览器。
# 双击本文件即可使用；再次双击会复用已在运行的服务。
cd "$(dirname "$0")"
PORT=${LOCALLENS_PORT:-8437}

if ! lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  nohup python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
  # 等服务就绪
  for i in {1..20}; do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
    sleep 0.15
  done
fi

open "http://127.0.0.1:$PORT/"
