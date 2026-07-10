#!/bin/zsh
# 生成 LocalLens.app：一个可以双击启动、也可以把文件拖到图标上直接打开的 Mac 应用。
# 运行一次即可，之后建议把生成的 LocalLens.app 拖进「应用程序」文件夹。
# 还可以在任意文件上「右键 → 打开方式 → LocalLens」。
set -e
cd "$(dirname "$0")"
LENS_DIR="$(pwd)"
APP="$LENS_DIR/LocalLens.app"

TMP_SCRIPT="$(mktemp -t locallens).applescript"
cat > "$TMP_SCRIPT" <<APPLESCRIPT
on ensureServer()
	set lensDir to "$LENS_DIR"
	do shell script "cd " & quoted form of lensDir & " && if ! /usr/sbin/lsof -nP -iTCP:8437 -sTCP:LISTEN >/dev/null 2>&1; then nohup /usr/bin/python3 server.py >/dev/null 2>&1 & fi; for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do /usr/bin/curl -s -o /dev/null http://127.0.0.1:8437/api/ping && break; sleep 0.1; done"
end ensureServer

on openLens(theUrl)
	if (do shell script "test -d '/Applications/Google Chrome.app' && echo yes || echo no") is "yes" then
		do shell script "open -na 'Google Chrome' --args --app=" & quoted form of theUrl
	else if (do shell script "test -d '/Applications/Microsoft Edge.app' && echo yes || echo no") is "yes" then
		do shell script "open -na 'Microsoft Edge' --args --app=" & quoted form of theUrl
	else
		do shell script "open " & quoted form of theUrl
	end if
end openLens

on run
	ensureServer()
	openLens("http://127.0.0.1:8437/")
end run

on open theFiles
	ensureServer()
	repeat with f in theFiles
		set p to POSIX path of f
		set encoded to do shell script "/usr/bin/python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' " & quoted form of p
		openLens("http://127.0.0.1:8437/?path=" & encoded)
	end repeat
end open
APPLESCRIPT

rm -rf "$APP"
osacompile -o "$APP" "$TMP_SCRIPT"
rm -f "$TMP_SCRIPT"

# 声明可接收所有类型的文件（拖到图标 / 打开方式）
/usr/libexec/PlistBuddy -c 'Add :CFBundleDocumentTypes array' "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c 'Add :CFBundleDocumentTypes:0 dict' "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c 'Add :CFBundleDocumentTypes:0:CFBundleTypeName string "All Files"' "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c 'Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer' "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c 'Add :CFBundleDocumentTypes:0:LSItemContentTypes array' "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c 'Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string public.data' "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c 'Add :CFBundleDocumentTypes:0:LSItemContentTypes:1 string public.item' "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c 'Set :CFBundleName LocalLens' "$APP/Contents/Info.plist" 2>/dev/null || \
/usr/libexec/PlistBuddy -c 'Add :CFBundleName string LocalLens' "$APP/Contents/Info.plist" 2>/dev/null || true

# 刷新 LaunchServices 注册
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null 2>&1 || true

echo "✅ 已生成 $APP"
echo "   · 双击启动 LocalLens"
echo "   · 把文件拖到它的图标上直接打开"
echo "   · 建议拖入「应用程序」并固定到 Dock"
