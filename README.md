# LocalLens 🔍

**本地万能文件预览与编辑器。一个窗口，打开一切。**

LocalLens 是一个纯本地运行的文件查看器：拖一个文件进来，它就能打开。PDF、Word、Excel、Markdown、图片、音视频、代码、压缩包、3D 模型、字体，全部在同一个界面里预览，其中文本类格式还能直接编辑并写回原文件。

没有账号，没有订阅，没有云端。所有解析和渲染都发生在你自己的浏览器里，**不发出任何网络请求，任何数据都不会离开你的电脑**。

![](https://img.shields.io/badge/依赖-零安装-brightgreen) ![](https://img.shields.io/badge/运行-100%25_本地-blue) ![](https://img.shields.io/badge/许可-MIT-lightgrey)

## 快速开始

```bash
git clone https://github.com/cocohahaha/locallens.git
cd locallens
```

**macOS**：双击 `start.command`（或在终端运行 `./start.command`）。

**任何系统**：在项目目录起一个静态服务即可：

```bash
python3 -m http.server 8437
# 然后打开 http://localhost:8437/
```

唯一的要求是本机有 Python 3（macOS 自带）和一个现代浏览器。推荐 Chrome 或 Edge：它们支持 File System Access API，编辑后可以一键写回原文件；其他浏览器会降级为「下载保存」。

> 为什么需要起一个本地服务，而不是直接双击 index.html？因为 PDF 渲染依赖的 Web Worker 和 ES Module 在 `file://` 协议下会被浏览器禁止。服务只绑定在 127.0.0.1，不对外暴露。

## 支持的格式

| 类别 | 格式 | 能做什么 |
|------|------|----------|
| 文档 | PDF | 分页渲染、缩放、提取全文为 .txt |
| 文档 | Word (.docx) | 排版预览、导出 HTML、提取纯文本、打印/存 PDF |
| 表格 | Excel (.xlsx/.xls/.xlsm/.ods) | 多工作表切换、转 CSV、转 JSON |
| 表格 | CSV / TSV | 表格视图、转 JSON、转 Excel |
| 文本 | Markdown | 实时双栏编辑、保存回原文件、导出 HTML、打印/存 PDF |
| 文本 | HTML | 沙箱安全渲染（默认禁脚本）、查看源码 |
| 文本 | JSON / JSONL / YAML | 自动美化、语法高亮、编辑、JSON ↔ YAML 互转、minify |
| 代码 | JS/TS/Python/Go/Rust/Java/Swift/SQL/Shell 等 40+ 种 | 语法高亮、编辑保存、复制全文 |
| 图片 | PNG/JPG/GIF/WebP/AVIF/BMP/ICO/SVG | 缩放查看、格式互转（PNG ↔ JPG，SVG 栅格化） |
| 视频 | MP4/WebM/MOV/M4V/OGV | 播放、截取当前帧为 PNG |
| 音频 | MP3/WAV/FLAC/M4A/AAC/OGG/Opus | 播放 |
| 压缩包 | ZIP/EPUB/JAR/APK/CBZ 等 | 列出内容，点击内部文件直接预览、单文件解压 |
| 3D | GLB/GLTF/OBJ/STL | 实时渲染，拖动旋转、滚轮缩放、右键平移 |
| 字体 | TTF/OTF/WOFF/WOFF2 | 多字号预览、自定义文字实时试字 |
| 其他 | 未识别的二进制 | 自动嗅探：文本则高亮显示，否则十六进制查看 |

## 交互设计

界面遵循「内容优先」：打开文件后工具栏自动隐藏，鼠标移到窗口顶部时浮现；左缘悬停呼出已打开文件列表。快捷键：`⌘O` 打开，`⌘S` 保存，`Esc` 回到首页。

编辑与保存的行为：

- 通过「打开」按钮或拖拽进来的文件（Chrome/Edge），保存时**直接写回原文件**，首次会弹一次系统授权。
- 其他情况自动降级为「另存为 / 下载」。
- 有未保存修改时切换文件或关闭页面会提醒。

## 试一试

仓库自带一组示例文件，起服务后访问：

```
http://localhost:8437/?open=samples/demo.md      # Markdown 编辑
http://localhost:8437/?open=samples/demo.xlsx    # Excel 多表
http://localhost:8437/?open=samples/demo.stl     # 3D 模型
http://localhost:8437/?open=samples/demo.zip     # 压缩包浏览
```

## 技术说明

纯静态页面，无构建步骤，无 Node 依赖，clone 下来就能跑。所有第三方库都已打包在 `vendor/` 目录内（离线可用）：

- [pdf.js](https://mozilla.github.io/pdf.js/) — PDF 渲染
- [SheetJS](https://sheetjs.com/) — Excel 解析
- [mammoth.js](https://github.com/mwilliamson/mammoth.js) — docx 转 HTML
- [marked](https://marked.js.org/) — Markdown 渲染
- [highlight.js](https://highlightjs.org/) — 代码高亮
- [JSZip](https://stuk.github.io/jszip/) — 压缩包解析
- [three.js](https://threejs.org/) — 3D 渲染
- [js-yaml](https://github.com/nodeca/js-yaml) — YAML 解析

应用本体是一个约 900 行的 ES Module（`js/app.js`），按扩展名路由到对应查看器，pdf.js 和 three.js 均为按需动态加载，首屏不背包袱。

## 已知边界

- `.doc`（旧版 Word）、`.pptx`、`.rar`、`.7z` 暂不支持。
- `.gltf` 若引用外部贴图/bin 文件，需使用打包好的 `.glb`。
- 视频/音频解码能力取决于浏览器（如 HEVC 需要系统支持）。
- 大表格显示前 3000 行，避免页面卡死。

## 许可

MIT
