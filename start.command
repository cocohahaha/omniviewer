#!/bin/zsh
# OmniViewer 启动器：起本地服务并打开独立应用窗口。
# 双击即用；重复双击会复用已在运行的服务。
cd "$(dirname "$0")"
PORT=${OMNIVIEWER_PORT:-8437}
URL="http://127.0.0.1:$PORT/"

if ! lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  nohup python3 server.py >/dev/null 2>&1 &
  for i in {1..30}; do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/api/ping" && break
    sleep 0.1
  done
fi

# 优先用 Chrome/Edge 的独立应用窗口（无浏览器边框，更像原生 App）
if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="$URL"
elif [ -d "/Applications/Microsoft Edge.app" ]; then
  open -na "Microsoft Edge" --args --app="$URL"
else
  open "$URL"
fi
