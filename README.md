# LocalLens 🔍

**本地万能文件预览与编辑器。一个窗口，打开一切。**

拖一个文件进来就能打开：PDF、Word、PPT、Excel、Markdown、图片、音视频、代码、压缩包、3D 模型、字体。文本类文件可以直接编辑并写回原文件。

没有账号，没有订阅，没有云端。所有解析和渲染都发生在你自己的电脑上，服务只绑定 127.0.0.1，**任何数据都不会离开本机**。

![](https://img.shields.io/badge/依赖-仅需_Python_3-brightgreen) ![](https://img.shields.io/badge/运行-100%25_本地-blue) ![](https://img.shields.io/badge/许可-MIT-lightgrey)

## 快速开始（macOS）

```bash
git clone https://github.com/cocohahaha/locallens.git
cd locallens
./make-app.command   # 生成 LocalLens.app（只需一次）
```

生成的 **LocalLens.app** 就是日常入口：

- 双击启动，得到一个无浏览器边框的独立应用窗口；
- 把任意文件**拖到它的图标上**直接打开；
- 在文件上「右键 → 打开方式 → LocalLens」；
- 建议把它拖进「应用程序」并固定到 Dock。

不想生成 App 的话，双击 `start.command` 也一样能用。

**其他系统**：`python3 server.py` 然后打开 `http://localhost:8437/`。

要求：Python 3（macOS 自带）+ 现代浏览器。推荐 Chrome/Edge（独立窗口模式 + 文件直接写回保存）。

## 支持的格式

| 类别 | 格式 | 能做什么 |
|------|------|----------|
| 文档 | PDF | 分页渲染、缩放、提取全文。内置 CJK 字体映射，中文 PDF 不乱码 |
| 文档 | Word (.docx) | 排版预览、导出 HTML、提取纯文本、存 PDF |
| 文档 | PowerPoint (.pptx) | 大纲视图：逐页标题、正文、图片，提取全文 |
| 表格 | Excel (.xlsx/.xls/.xlsm/.ods) | 多工作表切换、转 CSV（带 BOM 不乱码）、转 JSON |
| 表格 | CSV / TSV | 表格视图、转 JSON、转 Excel。**GBK/UTF-8 编码自动识别** |
| 文本 | Markdown | 双栏实时编辑、保存写回、导出 HTML、存 PDF |
| 文本 | HTML | 沙箱安全渲染（默认禁脚本）、查看源码 |
| 文本 | JSON / JSONL / YAML | 自动美化、高亮、编辑、JSON ↔ YAML 互转 |
| 代码 | 40+ 语言 | 高亮、编辑保存、复制全文、手动切换编码 |
| 图片 | PNG/JPG/GIF/WebP/AVIF/BMP/ICO/SVG | 缩放、格式互转 |
| 图片 | **HEIC/HEIF**（iPhone 照片） | 本地解码预览、导出 JPG |
| 视频 | MP4/WebM/MOV/M4V | 播放、截取当前帧 |
| 音频 | MP3/WAV/FLAC/M4A/AAC/OGG | 播放 |
| 压缩包 | ZIP/EPUB/JAR/APK + **TAR/GZ/TGZ** | 列出内容（自动过滤 macOS 垃圾文件），点开内部文件直接预览 |
| 3D | GLB/GLTF/OBJ/STL | 实时渲染，旋转/缩放/平移 |
| 字体 | TTF/OTF/WOFF/WOFF2 | 多字号预览、自定义试字 |
| 其他 | 未识别格式 | 文本自动嗅探（含编码），二进制转十六进制查看 |

中文用户最常踩的坑都处理过：Excel 导出的 GBK 编码 CSV 自动识别不乱码；中文字体 PDF 正常渲染；导出的 CSV 带 BOM，Excel 双击直接打开。

## 界面

左侧固定侧栏：打开按钮、已打开文件列表、最近打开（可 ⌘B 收起）。顶部常驻工具栏：当前文件信息 + 当前格式可用的所有操作。支持一次拖入多个文件甚至整个文件夹，在侧栏里切换。

快捷键：`⌘O` 打开 · `⌘S` 保存 · `⌘B` 侧栏 · `Esc` 回首页。

## 保存与安全

- 通过 App 图标 / 「打开方式」/ 最近列表打开的文件：保存时**直接写回原路径**。
- 拖拽或选择器打开的文件（Chrome/Edge）：通过浏览器授权后写回。
- 其余情况降级为「另存为」。

本地服务的写回接口只接受来自 LocalLens 自己页面的请求（Origin 校验），且只允许覆盖已存在的文件；文件读取接口同样有来源校验。服务永远只监听 127.0.0.1。

## 技术说明

前端为纯静态页面 + 一个约 100 行的 Python 标准库服务（`server.py`，负责路径直开与写回）。无构建步骤，无 npm install，全部第三方库已打包在 `vendor/`（离线可用）：

[pdf.js](https://mozilla.github.io/pdf.js/) · [SheetJS](https://sheetjs.com/) · [mammoth.js](https://github.com/mwilliamson/mammoth.js) · [marked](https://marked.js.org/) · [highlight.js](https://highlightjs.org/) · [JSZip](https://stuk.github.io/jszip/) · [fflate](https://github.com/101arrowz/fflate) · [three.js](https://threejs.org/) · [js-yaml](https://github.com/nodeca/js-yaml) · [heic-to](https://github.com/hoppergee/heic-to)

PPTX 大纲、TAR 解析、CSV 解析、编码嗅探为自研实现。pdf.js、three.js、HEIC 解码均按需动态加载，首屏无负担。

## 已知边界

- 旧版二进制 Office（.doc/.ppt）与 iWork 格式：给出转换指引，不直接渲染。
- RAR/7z：建议先用 [Keka](https://www.keka.io/) 解压。
- `.gltf` 引用外部资源时请改用打包的 `.glb`。
- 视频解码能力取决于浏览器（MKV/HEVC 建议用 IINA/VLC）。
- 大表格显示前 3000 行（导出转换不受影响）。

## 许可

MIT
