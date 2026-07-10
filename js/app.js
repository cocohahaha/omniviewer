/* LocalLens v2 — 本地万能文件预览与编辑
 * 纯前端实现，配合可选的本地 server.py（路径直开、写回保存）。
 * 所有解析、渲染都发生在本机浏览器里。
 */
import { marked } from '../vendor/marked.esm.js';
import { load as yamlLoad, dump as yamlDump } from '../vendor/js-yaml.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ============================== 全局状态 ============================== */

const state = {
  files: [],          // { id, name, file, handle?, path?, forceEncoding?, parentZip? }
  current: null,
  dirty: false,
  editorGetValue: null,
  cleanup: null,
};
let nextId = 1;

const ui = {
  actions: $('#tb-actions'),
  fileName: $('#file-name'),
  fileMeta: $('#file-meta'),
  dirtyDot: $('#dirty-dot'),
  home: $('#home'),
  viewer: $('#viewer'),
  fileList: $('#file-list'),
  filesSection: $('#sb-files-section'),
  recentSection: $('#sb-recent-section'),
  recentList: $('#recent-list'),
  homeRecent: $('#home-recent'),
  homeRecentList: $('#home-recent-list'),
  dropOverlay: $('#drop-overlay'),
  toast: $('#toast'),
  loading: $('#loading'),
  loadingText: $('#loading-text'),
  input: $('#file-input'),
};

function toast(msg, ms = 2800) {
  ui.toast.textContent = msg;
  ui.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (ui.toast.hidden = true), ms);
}
function showLoading(text) { ui.loadingText.textContent = text || '正在打开…'; ui.loading.hidden = false; }
function hideLoading() { ui.loading.hidden = true; }
function setDirty(v) { state.dirty = v; ui.dirtyDot.hidden = !v; }

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}
function baseName(name) { return name.replace(/\.[^.]+$/, ''); }
function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('已导出 ' + name);
}

/* ============================== 编码识别 ============================== */

const ENCODINGS = [
  ['auto', '编码：自动'], ['utf-8', 'UTF-8'], ['gb18030', 'GB18030（简体）'],
  ['big5', 'Big5（繁体）'], ['shift_jis', 'Shift-JIS'], ['euc-kr', 'EUC-KR'],
  ['utf-16le', 'UTF-16 LE'], ['windows-1252', 'Latin-1'],
];

async function readText(rec) {
  const buf = await rec.file.arrayBuffer();
  if (rec.forceEncoding && rec.forceEncoding !== 'auto') {
    return { text: strip(new TextDecoder(rec.forceEncoding).decode(buf)), enc: rec.forceEncoding };
  }
  try {
    return { text: strip(new TextDecoder('utf-8', { fatal: true }).decode(buf)), enc: 'utf-8' };
  } catch {
    // 非 UTF-8：对中文用户最常见的是 GBK/GB18030（Excel 导出的 CSV、老 txt）
    return { text: strip(new TextDecoder('gb18030').decode(buf)), enc: 'gb18030' };
  }
  function strip(t) { return t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t; }
}

function addEncodingSelect(rec, detected) {
  const s = addSelect(ENCODINGS, async v => {
    rec.forceEncoding = v;
    await openRecord(rec, { force: true });
  }, rec.forceEncoding || 'auto');
  if (!rec.forceEncoding || rec.forceEncoding === 'auto') {
    s.options[0].textContent = `编码：自动（${detected}）`;
  }
  return s;
}

/* ============================== 最近打开（仅限有路径的文件） ============================== */

const RECENT_KEY = 'locallens-recent';
function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}
function pushRecent(path, name) {
  const list = getRecent().filter(r => r.path !== path);
  list.unshift({ path, name, ts: Date.now() });
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12)));
  renderRecent();
}
function renderRecent() {
  const list = getRecent();
  ui.recentSection.hidden = list.length === 0;
  ui.homeRecent.hidden = list.length === 0;
  ui.recentList.innerHTML = '';
  ui.homeRecentList.innerHTML = '';
  for (const r of list.slice(0, 8)) {
    const li = el('li');
    li.append(el('span', 'fl-badge', extOf(r.name) || 'file'), el('span', 'fl-name', r.name));
    li.title = r.path;
    li.onclick = () => openPath(r.path);
    ui.recentList.appendChild(li);
  }
  for (const r of list.slice(0, 5)) {
    const li = el('li');
    li.append(el('span', null, r.name), el('span', 'rp', r.path));
    li.onclick = () => openPath(r.path);
    ui.homeRecentList.appendChild(li);
  }
}

/* ============================== 文件管理 ============================== */

async function addFiles(items) {
  let first = null;
  for (const it of items) {
    const rec = {
      id: nextId++, name: it.file.name, file: it.file,
      handle: it.handle || null, path: it.path || null,
    };
    state.files.push(rec);
    if (!first) first = rec;
  }
  renderFileList();
  if (first) await openRecord(first);
}

function renderFileList() {
  ui.filesSection.hidden = state.files.length === 0;
  ui.fileList.innerHTML = '';
  for (const rec of state.files) {
    const li = el('li');
    li.classList.toggle('active', state.current === rec);
    const close = el('button', 'fl-close', '×');
    close.title = '移除';
    close.onclick = async e => {
      e.stopPropagation();
      if (rec === state.current && !(await confirmDiscard())) return;
      state.files = state.files.filter(f => f !== rec);
      if (rec === state.current) {
        const next = state.files[0];
        next ? openRecord(next) : goHome();
      } else renderFileList();
    };
    li.append(el('span', 'fl-badge', extOf(rec.name) || 'file'), el('span', 'fl-name', rec.name), close);
    li.title = rec.path || rec.name;
    li.onclick = () => openRecord(rec);
    ui.fileList.appendChild(li);
  }
}

async function confirmDiscard() {
  if (!state.dirty) return true;
  return confirm('当前文件有未保存的修改，确定丢弃吗？');
}

async function openRecord(rec, opts = {}) {
  if (rec !== state.current && !opts.force && !(await confirmDiscard())) return;
  if (state.cleanup) { try { state.cleanup(); } catch {} state.cleanup = null; }
  state.current = rec;
  state.editorGetValue = null;
  setDirty(false);

  ui.home.hidden = true;
  ui.viewer.hidden = false;
  ui.viewer.innerHTML = '';
  ui.actions.innerHTML = '';
  ui.fileName.textContent = rec.name;
  ui.fileName.title = rec.path || rec.name;
  ui.fileMeta.textContent = fmtSize(rec.file.size);
  renderFileList();

  const ext = extOf(rec.name);
  const viewer = pickViewer(ext, rec.file.type);
  try {
    if (rec.file.size > 3 * 1048576) showLoading('正在打开 ' + rec.name + ' …');
    await viewer(rec, ext);
  } catch (err) {
    console.error('[LocalLens]', err);
    ui.viewer.innerHTML = '';
    showInfo('⚠️', `打开失败：${err.message || err}`,
      '如果这是一个常见格式，欢迎把文件类型反馈给作者。');
  } finally {
    hideLoading();
  }
}

function goHome() {
  if (state.cleanup) { try { state.cleanup(); } catch {} state.cleanup = null; }
  state.current = null;
  state.editorGetValue = null;
  setDirty(false);
  ui.viewer.hidden = true;
  ui.viewer.innerHTML = '';
  ui.actions.innerHTML = '';
  ui.fileName.textContent = '';
  ui.fileMeta.textContent = '';
  ui.home.hidden = false;
  renderFileList();
}

function showInfo(icon, text, hint) {
  const box = el('div', 'center-info');
  box.append(el('div', 'big', icon), el('div', null, text));
  if (hint) box.append(el('div', 'hint', hint));
  ui.viewer.appendChild(box);
}
function setMeta(text) { ui.fileMeta.textContent = text; }

/* ============================== 打开：选择器 / 路径 / 拖拽 ============================== */

async function pickAndOpen() {
  if (window.showOpenFilePicker) {
    try {
      const handles = await showOpenFilePicker({ multiple: true });
      const items = [];
      for (const h of handles) items.push({ file: await h.getFile(), handle: h });
      await addFiles(items);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  ui.input.click();
}

async function openPath(path) {
  showLoading('正在读取 ' + path.split('/').pop() + ' …');
  try {
    const res = await fetch('/api/file?path=' + encodeURIComponent(path));
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || 'HTTP ' + res.status);
    }
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('X-File-Name') || path.split('/').pop());
    pushRecent(path, name);
    await addFiles([{ file: new File([blob], name), path }]);
  } catch (err) {
    toast('无法打开：' + err.message, 4500);
    const list = getRecent().filter(r => r.path !== path);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    renderRecent();
  } finally {
    hideLoading();
  }
}

/* 文件夹递归展开（拖入文件夹时） */
async function collectHandle(handle, out, depth = 0) {
  if (out.length >= 300 || depth > 6) return;
  if (handle.kind === 'file') {
    const f = await handle.getFile();
    if (!f.name.startsWith('.')) out.push({ file: f, handle });
  } else if (handle.kind === 'directory') {
    for await (const child of handle.values()) {
      if (child.name.startsWith('.')) continue;
      await collectHandle(child, out, depth + 1);
      if (out.length >= 300) break;
    }
  }
}

/* ============================== 保存 ============================== */

async function saveCurrent() {
  const rec = state.current;
  if (!rec || !state.editorGetValue) return;
  const text = state.editorGetValue();

  // 1) 通过 server.py 打开的文件：POST 写回原路径
  if (rec.path) {
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: rec.path, content: text }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'HTTP ' + res.status);
      rec.file = new File([text], rec.name, { type: rec.file.type });
      setDirty(false);
      toast('已保存到 ' + rec.path);
      return;
    } catch (err) {
      console.warn('[LocalLens] 服务写回失败', err);
    }
  }
  // 2) File System Access API 句柄：直接写回
  if (rec.handle) {
    try {
      if ((await rec.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        const p = await rec.handle.requestPermission({ mode: 'readwrite' });
        if (p !== 'granted') throw new Error('未授权写入');
      }
      const w = await rec.handle.createWritable();
      await w.write(text);
      await w.close();
      rec.file = new File([text], rec.name, { type: rec.file.type });
      setDirty(false);
      toast('已保存 ✓');
      return;
    } catch (err) {
      console.warn('[LocalLens] 句柄写入失败，降级为另存', err);
    }
  }
  await saveAs(text);
}

async function saveAs(text) {
  const rec = state.current;
  const content = text != null ? text : (state.editorGetValue ? state.editorGetValue() : null);
  if (content == null) return;
  if (window.showSaveFilePicker) {
    try {
      const handle = await showSaveFilePicker({ suggestedName: rec.name });
      const w = await handle.createWritable();
      await w.write(content);
      await w.close();
      rec.handle = handle;
      rec.path = null;
      rec.name = handle.name || rec.name;
      rec.file = new File([content], rec.name, { type: rec.file.type });
      setDirty(false);
      renderFileList();
      ui.fileName.textContent = rec.name;
      toast('已保存 ✓');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  downloadBlob(rec.name, new Blob([content]));
}

/* ============================== 工具栏动作 ============================== */

function addAction(label, fn, opts = {}) {
  const b = el('button', opts.primary ? 'primary' : null, label);
  if (opts.title) b.title = opts.title;
  b.onclick = fn;
  ui.actions.appendChild(b);
  return b;
}
function addSep() { ui.actions.appendChild(el('span', 'sep')); }
function addSelect(options, onChange, selected) {
  const s = el('select');
  for (const [val, label] of options) {
    const o = el('option', null, label);
    o.value = val;
    if (val === selected) o.selected = true;
    s.appendChild(o);
  }
  s.onchange = () => onChange(s.value);
  ui.actions.appendChild(s);
  return s;
}
function addRevealAction(rec) {
  if (!rec.path) return;
  addAction('在访达中显示', () => fetch('/api/reveal?path=' + encodeURIComponent(rec.path)).catch(() => {}));
}

/* 文本类查看器共用的「编辑 / 保存」按钮组 */
function addEditActions(getTa, onToggle) {
  let editing = false;
  const btn = addAction('✎ 编辑', () => {
    editing = !editing;
    btn.textContent = editing ? '✓ 完成' : '✎ 编辑';
    onToggle(editing);
    if (editing) getTa().focus();
  });
  addAction('保存', saveCurrent, { primary: true, title: '⌘S · 直接写回原文件' });
  addAction('另存为', () => saveAs());
  return btn;
}

/* ============================== 格式路由 ============================== */

const EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'],
  heic: ['heic', 'heif'],
  pdf: ['pdf'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'weba'],
  markdown: ['md', 'markdown', 'mdown', 'mkd'],
  html: ['html', 'htm', 'xhtml'],
  sheet: ['xlsx', 'xls', 'xlsm', 'ods'],
  csv: ['csv', 'tsv'],
  docx: ['docx'],
  pptx: ['pptx'],
  zip: ['zip', 'epub', 'cbz', 'jar', 'apk', 'xpi', 'crx', 'ipa'],
  tar: ['tar', 'gz', 'tgz'],
  unsupportedArchive: ['rar', '7z', 'bz2', 'xz', 'zst', 'dmg'],
  model3d: ['glb', 'gltf', 'obj', 'stl'],
  font: ['ttf', 'otf', 'woff', 'woff2'],
  json: ['json', 'jsonl', 'geojson', 'ipynb', 'webmanifest'],
  yaml: ['yaml', 'yml'],
  legacyOffice: ['doc', 'ppt', 'xlsb', 'pages', 'key', 'numbers'],
};

const CODE_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', py: 'python', rb: 'ruby', go: 'go',
  rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash',
  zsh: 'bash', bash: 'bash', fish: 'bash', sql: 'sql', css: 'css',
  scss: 'scss', less: 'less', xml: 'xml', toml: 'ini',
  ini: 'ini', conf: 'ini', properties: 'ini', env: 'bash', lua: 'lua',
  r: 'r', pl: 'perl', dart: 'dart', gradle: 'groovy', groovy: 'groovy',
  vue: 'xml', svelte: 'xml', dockerfile: 'dockerfile', makefile: 'makefile',
  txt: 'plaintext', log: 'plaintext', text: 'plaintext', gitignore: 'plaintext',
  lock: 'plaintext', srt: 'plaintext', vtt: 'plaintext', plist: 'xml',
};

function pickViewer(ext, mime) {
  if (EXT.image.includes(ext)) return viewImage;
  if (EXT.heic.includes(ext)) return viewHeic;
  if (EXT.pdf.includes(ext)) return viewPDF;
  if (EXT.video.includes(ext)) return viewVideo;
  if (EXT.audio.includes(ext)) return viewAudio;
  if (EXT.markdown.includes(ext)) return viewMarkdown;
  if (EXT.html.includes(ext)) return viewHTML;
  if (EXT.sheet.includes(ext)) return viewSheet;
  if (EXT.csv.includes(ext)) return viewCSV;
  if (EXT.docx.includes(ext)) return viewDocx;
  if (EXT.pptx.includes(ext)) return viewPptx;
  if (EXT.zip.includes(ext)) return viewZip;
  if (EXT.tar.includes(ext)) return viewTar;
  if (EXT.unsupportedArchive.includes(ext)) return viewUnsupportedArchive;
  if (EXT.model3d.includes(ext)) return view3D;
  if (EXT.font.includes(ext)) return viewFont;
  if (EXT.json.includes(ext)) return viewJSON;
  if (EXT.yaml.includes(ext)) return viewYAML;
  if (EXT.legacyOffice.includes(ext)) return viewLegacyOffice;
  if (ext in CODE_LANG) return viewCode;
  if (mime && mime.startsWith('text/')) return viewCode;
  if (mime && mime.startsWith('image/')) return viewImage;
  if (mime && mime.startsWith('video/')) return viewVideo;
  if (mime && mime.startsWith('audio/')) return viewAudio;
  return viewUnknown;
}

/* ============================== 图片 / HEIC ============================== */

async function viewImage(rec, ext, blobOverride) {
  const blob = blobOverride || rec.file;
  const url = URL.createObjectURL(blob);
  state.cleanup = () => URL.revokeObjectURL(url);

  const stage = el('div', 'img-stage viewer-full');
  const img = el('img');
  img.src = url;
  stage.appendChild(img);
  ui.viewer.appendChild(stage);

  await img.decode().catch(() => {});
  const nw = img.naturalWidth, nh = img.naturalHeight;
  setMeta(`${nw}×${nh} · ${fmtSize(rec.file.size)}`);

  let zoom = 0;
  const apply = () => {
    if (zoom === 0) {
      img.style.maxWidth = 'calc(100% - 48px)';
      img.style.maxHeight = 'calc(100% - 48px)';
      img.style.width = img.style.height = '';
    } else {
      img.style.maxWidth = img.style.maxHeight = 'none';
      img.style.width = nw * zoom + 'px';
      img.style.height = 'auto';
    }
  };
  apply();

  addAction('适应', () => { zoom = 0; apply(); });
  addAction('100%', () => { zoom = 1; apply(); });
  addAction('＋', () => { zoom = (zoom || 1) * 1.25; apply(); });
  addAction('－', () => { zoom = Math.max(0.05, (zoom || 1) / 1.25); apply(); });
  addSep();

  const rasterize = (type, name) => {
    const canvas = el('canvas');
    canvas.width = nw; canvas.height = nh;
    const ctx = canvas.getContext('2d');
    if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, nw, nh); }
    ctx.drawImage(img, 0, 0);
    canvas.toBlob(b => b ? downloadBlob(name, b) : toast('转换失败'), type, 0.92);
  };
  if (ext !== 'png') addAction('转 PNG', () => rasterize('image/png', baseName(rec.name) + '.png'));
  if (ext !== 'jpg' && ext !== 'jpeg') addAction('转 JPG', () => rasterize('image/jpeg', baseName(rec.name) + '.jpg'));
  addRevealAction(rec);
}

async function viewHeic(rec, ext) {
  showLoading('正在解码 HEIC …');
  const { heicTo } = await import('../vendor/heic-to.min.mjs');
  const jpeg = await heicTo({ blob: rec.file, type: 'image/jpeg', quality: 0.92 });
  await viewImage(rec, 'heic', jpeg);
  addSep();
  addAction('导出 JPG', () => downloadBlob(baseName(rec.name) + '.jpg', jpeg));
}

/* ============================== PDF ============================== */

async function viewPDF(rec) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

  const data = await rec.file.arrayBuffer();
  const doc = await pdfjs.getDocument({
    data,
    // 中文/日文 PDF 需要字体映射表，否则会白页或乱码
    cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href,
    wasmUrl: new URL('../vendor/pdfjs/wasm/', import.meta.url).href,
  }).promise;
  setMeta(`${doc.numPages} 页 · ${fmtSize(rec.file.size)}`);

  const scroll = el('div', 'pdf-scroll viewer-full');
  ui.viewer.appendChild(scroll);

  let scale = 0;
  let renderToken = 0;

  async function renderAll() {
    const token = ++renderToken;
    scroll.innerHTML = '';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (let i = 1; i <= doc.numPages; i++) {
      if (token !== renderToken) return;
      const page = await doc.getPage(i);
      let s = scale;
      if (s === 0) {
        const vw1 = page.getViewport({ scale: 1 });
        s = Math.min((scroll.clientWidth - 60) / vw1.width, 1.6);
      }
      const vp = page.getViewport({ scale: s });
      const canvas = el('canvas');
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = vp.width + 'px';
      canvas.style.height = vp.height + 'px';
      scroll.appendChild(canvas);
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: vp,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      }).promise;
    }
  }

  addSelect([['0', '适应宽度'], ['0.75', '75%'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%']],
    v => { scale = parseFloat(v); renderAll(); }, '0');
  addSep();
  addAction('提取全文', async () => {
    const parts = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      parts.push(tc.items.map(it => it.str).join(' '));
    }
    downloadBlob(baseName(rec.name) + '.txt', new Blob([parts.join('\n\n')], { type: 'text/plain' }));
  }, { title: '把 PDF 文字层导出为 .txt' });
  addRevealAction(rec);

  state.cleanup = () => { renderToken++; doc.destroy(); };
  await renderAll();
}

/* ============================== 音视频 ============================== */

async function viewVideo(rec, ext) {
  const url = URL.createObjectURL(rec.file);
  state.cleanup = () => URL.revokeObjectURL(url);
  const stage = el('div', 'media-stage viewer-full');
  const v = el('video');
  v.src = url; v.controls = true;
  stage.appendChild(v);
  ui.viewer.appendChild(stage);
  v.onerror = () => {
    stage.innerHTML = '';
    const box = el('div', 'center-info');
    box.append(el('div', 'big', '🎬'),
      el('div', null, '浏览器无法解码这个视频'),
      el('div', 'hint', ext === 'mkv'
        ? 'MKV 容器支持有限，取决于内部编码。可以用 IINA/VLC 播放，或用 ffmpeg 转成 MP4。'
        : '可能是 HEVC 等编码，取决于系统解码器。可以用 IINA/VLC 播放。'));
    stage.appendChild(box);
  };
  addAction('截取当前帧', () => {
    if (!v.videoWidth) return toast('请先播放到想截取的画面');
    const c = el('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(b => b && downloadBlob(baseName(rec.name) + '_frame.png', b), 'image/png');
  });
  addRevealAction(rec);
}

async function viewAudio(rec) {
  const url = URL.createObjectURL(rec.file);
  state.cleanup = () => URL.revokeObjectURL(url);
  const stage = el('div', 'media-stage viewer-full');
  const card = el('div', 'audio-card');
  card.append(el('div', 'big', '🎵'), el('div', null, rec.name));
  const a = el('audio');
  a.src = url; a.controls = true;
  card.appendChild(a);
  stage.appendChild(card);
  ui.viewer.appendChild(stage);
  addRevealAction(rec);
}

/* ============================== Markdown ============================== */

marked.setOptions({ gfm: true, breaks: false });

function renderMarkdownInto(container, text) {
  container.innerHTML = marked.parse(text);
  container.querySelectorAll('pre code').forEach(b => { try { hljs.highlightElement(b); } catch {} });
  container.querySelectorAll('a[href]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
}

function mdExportHTML(title, mdText) {
  const body = marked.parse(mdText);
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>${title}</title>
<style>body{max-width:820px;margin:40px auto;padding:0 24px;font-family:-apple-system,"PingFang SC",sans-serif;line-height:1.75;color:#24292f}
pre{background:#f6f8fa;padding:14px 16px;border-radius:8px;overflow-x:auto}code{font-family:ui-monospace,Menlo,monospace;font-size:.9em}
h1,h2{border-bottom:1px solid #eee;padding-bottom:.3em}img{max-width:100%}blockquote{border-left:3px solid #ddd;margin-left:0;padding-left:16px;color:#666}
table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 12px}</style></head><body>${body}</body></html>`;
}

async function viewMarkdown(rec) {
  const { text, enc } = await readText(rec);

  const split = el('div', 'edit-split single viewer-full');
  const ta = el('textarea', 'edit-ta');
  ta.value = text;
  ta.hidden = true;
  ta.spellcheck = false;
  const preview = el('div', 'edit-preview');
  const inner = el('div', 'viewer-pad doc-render');
  preview.appendChild(inner);
  split.append(ta, preview);
  ui.viewer.appendChild(split);
  renderMarkdownInto(inner, text);

  state.editorGetValue = () => ta.value;
  setMeta(`${text.split('\n').length} 行 · ${fmtSize(rec.file.size)}`);

  let raf = null;
  ta.oninput = () => {
    setDirty(true);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => renderMarkdownInto(inner, ta.value));
  };

  addEditActions(() => ta, editing => {
    ta.hidden = !editing;
    split.classList.toggle('single', !editing);
  });
  addSep();
  addAction('导出 HTML', () => downloadBlob(baseName(rec.name) + '.html',
    new Blob([mdExportHTML(rec.name, ta.value)], { type: 'text/html' })));
  addAction('存 PDF', () => printHTML(mdExportHTML(rec.name, ta.value)), { title: '通过系统打印对话框导出 PDF' });
  addSep();
  addEncodingSelect(rec, enc);
  addRevealAction(rec);
}

function printHTML(html) {
  const frame = el('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:none;visibility:hidden';
  document.body.appendChild(frame);
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  };
}

/* ============================== 代码 / 纯文本 / JSON / YAML ============================== */

function codeShell(rec, text, lang) {
  const wrap = el('div', 'code-wrap viewer-full');
  const pre = el('pre');
  const code = el('code', 'language-' + lang);
  code.textContent = text;
  pre.appendChild(code);
  wrap.appendChild(pre);
  ui.viewer.appendChild(wrap);
  if (text.length < 1_500_000) { try { hljs.highlightElement(code); } catch {} }

  const ta = el('textarea', 'edit-ta viewer-full');
  ta.value = text;
  ta.hidden = true;
  ta.spellcheck = false;
  ta.oninput = () => setDirty(true);
  ui.viewer.appendChild(ta);
  state.editorGetValue = () => ta.value;

  addEditActions(() => ta, editing => {
    wrap.hidden = editing;
    ta.hidden = !editing;
    if (!editing) {
      code.textContent = ta.value;
      code.removeAttribute('data-highlighted');
      try { hljs.highlightElement(code); } catch {}
    }
  });
  addAction('复制全文', async () => { await navigator.clipboard.writeText(ta.value); toast('已复制到剪贴板'); });
  return { wrap, ta, code };
}

async function viewCode(rec, ext) {
  const { text, enc } = await readText(rec);
  const name = rec.name.toLowerCase();
  let lang = CODE_LANG[ext] || 'plaintext';
  if (name === 'dockerfile') lang = 'dockerfile';
  if (name === 'makefile') lang = 'makefile';
  codeShell(rec, text, lang);
  setMeta(`${text.split('\n').length} 行 · ${fmtSize(rec.file.size)}`);
  addSep();
  addEncodingSelect(rec, enc);
  addRevealAction(rec);
}

async function viewJSON(rec, ext) {
  const { text: raw } = await readText(rec);
  let parsed = null, pretty = raw;
  try {
    if (ext === 'jsonl') {
      parsed = raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    } else {
      parsed = JSON.parse(raw);
    }
    pretty = JSON.stringify(parsed, null, 2);
  } catch (e) {
    toast('JSON 解析失败，按纯文本显示：' + e.message, 4200);
  }
  codeShell(rec, pretty, 'json');
  setMeta(fmtSize(rec.file.size));
  if (parsed != null) {
    addSep();
    addAction('转 YAML', () => downloadBlob(baseName(rec.name) + '.yaml',
      new Blob([yamlDump(parsed)], { type: 'text/yaml' })));
    addAction('压缩', () => downloadBlob(baseName(rec.name) + '.min.json',
      new Blob([JSON.stringify(parsed)], { type: 'application/json' })));
  }
  addRevealAction(rec);
}

async function viewYAML(rec) {
  const { text: raw, enc } = await readText(rec);
  codeShell(rec, raw, 'yaml');
  setMeta(fmtSize(rec.file.size));
  try {
    const parsed = yamlLoad(raw);
    addSep();
    addAction('转 JSON', () => downloadBlob(baseName(rec.name) + '.json',
      new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' })));
  } catch {}
  addEncodingSelect(rec, enc);
  addRevealAction(rec);
}

/* ============================== CSV / Excel ============================== */

function parseCSV(text, delim) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQ = false;
      } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function renderTable(container, rows, note) {
  const MAX_ROWS = 3000, MAX_COLS = 120;
  const scroll = el('div', 'table-scroll');
  const table = el('table', 'data-table');
  const shown = Math.min(rows.length, MAX_ROWS);
  for (let r = 0; r < shown; r++) {
    const tr = el('tr');
    const cols = Math.min(rows[r].length, MAX_COLS);
    for (let c = 0; c < cols; c++) {
      tr.appendChild(el(r === 0 ? 'th' : 'td', null, String(rows[r][c] ?? '')));
    }
    table.appendChild(tr);
  }
  scroll.appendChild(table);
  const msgs = [];
  if (rows.length > MAX_ROWS) msgs.push(`共 ${rows.length} 行，仅显示前 ${MAX_ROWS} 行（转换导出不受影响）`);
  if (note) msgs.push(note);
  if (msgs.length) container.appendChild(el('div', 'table-note', msgs.join(' · ')));
  container.appendChild(scroll);
}

async function viewCSV(rec, ext) {
  const { text, enc } = await readText(rec);
  const rows = parseCSV(text, ext === 'tsv' ? '\t' : ',');
  const host = el('div', 'table-host viewer-full');
  ui.viewer.appendChild(host);
  renderTable(host, rows);
  setMeta(`${rows.length} 行 × ${rows[0]?.length || 0} 列 · ${fmtSize(rec.file.size)}`);

  addAction('转 JSON', () => {
    const [head, ...body] = rows;
    const objs = body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
    downloadBlob(baseName(rec.name) + '.json', new Blob([JSON.stringify(objs, null, 2)], { type: 'application/json' }));
  });
  addAction('转 Excel', () => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, baseName(rec.name) + '.xlsx');
  });
  addSep();
  addEncodingSelect(rec, enc);
  addRevealAction(rec);
}

async function viewSheet(rec) {
  const buf = await rec.file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const host = el('div', 'table-host viewer-full');
  const tabs = el('div', 'sheet-tabs');
  const body = el('div', 'table-host');
  body.style.flex = '1 1 auto';
  body.style.minHeight = '0';
  host.append(tabs, body);
  ui.viewer.appendChild(host);

  let activeSheet = wb.SheetNames[0];
  function show(name) {
    activeSheet = name;
    body.innerHTML = '';
    [...tabs.children].forEach(b => b.classList.toggle('active', b.textContent === name));
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    renderTable(body, rows.length ? rows : [['（空表）']]);
  }
  for (const name of wb.SheetNames) {
    const b = el('button', null, name);
    b.onclick = () => show(name);
    tabs.appendChild(b);
  }
  show(activeSheet);
  setMeta(`${wb.SheetNames.length} 个工作表 · ${fmtSize(rec.file.size)}`);

  addAction('转 CSV', () => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[activeSheet]);
    downloadBlob(`${baseName(rec.name)}_${activeSheet}.csv`, new Blob(['﻿' + csv], { type: 'text/csv' }));
  }, { title: '导出当前工作表（带 BOM，Excel 直接打开不乱码）' });
  addAction('转 JSON', () => {
    const objs = XLSX.utils.sheet_to_json(wb.Sheets[activeSheet], { defval: '' });
    downloadBlob(`${baseName(rec.name)}_${activeSheet}.json`, new Blob([JSON.stringify(objs, null, 2)], { type: 'application/json' }));
  });
  addRevealAction(rec);
}

/* ============================== Word / PPT ============================== */

async function viewDocx(rec) {
  const buf = await rec.file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer: buf });
  const scroller = el('div', 'viewer-full');
  scroller.style.cssText = 'overflow:auto;height:100%';
  const pad = el('div', 'viewer-pad doc-render');
  pad.innerHTML = result.value || '<p>（空文档）</p>';
  scroller.appendChild(pad);
  ui.viewer.appendChild(scroller);

  addAction('导出 HTML', () => downloadBlob(baseName(rec.name) + '.html',
    new Blob([`<!DOCTYPE html><meta charset="utf-8"><title>${rec.name}</title><body style="max-width:820px;margin:40px auto;font-family:-apple-system,'PingFang SC',sans-serif;line-height:1.75">${result.value}</body>`], { type: 'text/html' })));
  addAction('提取纯文本', async () => {
    const t = await mammoth.extractRawText({ arrayBuffer: buf });
    downloadBlob(baseName(rec.name) + '.txt', new Blob([t.value], { type: 'text/plain' }));
  });
  addAction('存 PDF', () => printHTML(`<!DOCTYPE html><meta charset="utf-8"><body style="font-family:-apple-system,'PingFang SC',sans-serif;line-height:1.7">${result.value}</body>`));
  addRevealAction(rec);
}

const XML_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

async function viewPptx(rec) {
  const zip = await JSZip.loadAsync(await rec.file.arrayBuffer());
  const parser = new DOMParser();
  const urls = [];
  state.cleanup = () => urls.forEach(u => URL.revokeObjectURL(u));

  // 幻灯片顺序：presentation.xml + rels；失败则按文件名排序
  let slidePaths = [];
  try {
    const relsXml = parser.parseFromString(await zip.file('ppt/_rels/presentation.xml.rels').async('text'), 'application/xml');
    const relMap = {};
    for (const r of relsXml.getElementsByTagName('Relationship')) {
      relMap[r.getAttribute('Id')] = r.getAttribute('Target');
    }
    const presXml = parser.parseFromString(await zip.file('ppt/presentation.xml').async('text'), 'application/xml');
    for (const sld of presXml.getElementsByTagName('p:sldId')) {
      const target = relMap[sld.getAttribute('r:id')];
      if (target) slidePaths.push('ppt/' + target.replace(/^\.?\//, ''));
    }
  } catch {}
  if (!slidePaths.length) {
    slidePaths = Object.keys(zip.files)
      .filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => parseInt(a.match(/\d+/g).pop()) - parseInt(b.match(/\d+/g).pop()));
  }
  if (!slidePaths.length) throw new Error('没有找到幻灯片内容');

  const scroll = el('div', 'ppt-scroll viewer-full');
  ui.viewer.appendChild(scroll);
  const allText = [];

  for (let i = 0; i < slidePaths.length; i++) {
    const path = slidePaths[i];
    const card = el('div', 'ppt-slide');
    card.appendChild(el('div', 'ppt-num', `第 ${i + 1} 页 / 共 ${slidePaths.length} 页`));
    let title = '', paras = [];
    try {
      const xml = parser.parseFromString(await zip.file(path).async('text'), 'application/xml');
      for (const sp of xml.getElementsByTagName('p:sp')) {
        const ph = sp.getElementsByTagName('p:ph')[0];
        const isTitle = ph && /title/i.test(ph.getAttribute('type') || '');
        const texts = [];
        for (const p of sp.getElementsByTagNameNS(XML_A, 'p')) {
          const t = [...p.getElementsByTagNameNS(XML_A, 't')].map(n => n.textContent).join('');
          if (t.trim()) texts.push(t.trim());
        }
        if (!texts.length) continue;
        if (isTitle && !title) title = texts.join(' ');
        else paras.push(...texts);
      }
      // 表格文字
      for (const tbl of xml.getElementsByTagNameNS(XML_A, 'tbl')) {
        const cells = [...tbl.getElementsByTagNameNS(XML_A, 't')].map(n => n.textContent).filter(Boolean);
        if (cells.length) paras.push('〔表格〕 ' + cells.join(' | '));
      }
    } catch {}
    if (title) card.appendChild(el('h2', 'ppt-title', title));
    const txt = el('div', 'ppt-text');
    for (const p of paras) txt.appendChild(el('p', null, p));
    card.appendChild(txt);
    allText.push(`【第 ${i + 1} 页】${title ? ' ' + title : ''}\n` + paras.join('\n'));

    // 本页图片
    try {
      const relPath = path.replace('slides/', 'slides/_rels/') + '.rels';
      const relFile = zip.file(relPath);
      if (relFile) {
        const relXml = parser.parseFromString(await relFile.async('text'), 'application/xml');
        const imgWrap = el('div', 'ppt-imgs');
        const seen = new Set();
        for (const r of relXml.getElementsByTagName('Relationship')) {
          if (!/\/image$/.test(r.getAttribute('Type') || '')) continue;
          let target = r.getAttribute('Target').replace(/^(\.\.\/)+/, 'ppt/');
          if (seen.has(target) || !/\.(png|jpe?g|gif|webp|bmp)$/i.test(target)) continue;
          seen.add(target);
          const f = zip.file(target);
          if (!f) continue;
          const blob = await f.async('blob');
          const url = URL.createObjectURL(blob);
          urls.push(url);
          const img = el('img');
          img.src = url;
          img.loading = 'lazy';
          imgWrap.appendChild(img);
        }
        if (imgWrap.children.length) card.appendChild(imgWrap);
      }
    } catch {}
    scroll.appendChild(card);
  }

  setMeta(`${slidePaths.length} 页 · ${fmtSize(rec.file.size)} · 大纲视图`);
  addAction('提取全文', () => downloadBlob(baseName(rec.name) + '.txt',
    new Blob([allText.join('\n\n')], { type: 'text/plain' })));
  addRevealAction(rec);
}

function viewLegacyOffice(rec, ext) {
  const tips = {
    doc: '旧版 .doc 是二进制格式，建议用 Word/WPS 另存为 .docx 后再打开。',
    ppt: '旧版 .ppt 是二进制格式，建议用 PowerPoint/WPS 另存为 .pptx 后再打开。',
    xlsb: '请在 Excel 中另存为 .xlsx 后再打开。',
    pages: 'Apple iWork 格式，请用 Pages 导出为 PDF 或 Word。',
    key: 'Apple iWork 格式，请用 Keynote 导出为 PDF 或 PPTX。',
    numbers: 'Apple iWork 格式，请用 Numbers 导出为 Excel 或 CSV。',
  };
  showInfo('📄', `暂不支持 .${ext} 的直接预览`, tips[ext] || '');
}

/* ============================== 压缩包（ZIP / TAR / GZ） ============================== */

function renderArchiveList(entries, note) {
  // entries: { name, dir, size, getBlob() }
  const scroller = el('div', 'viewer-full');
  scroller.style.cssText = 'overflow:auto;height:100%';
  const files = entries.filter(e => !e.dir);
  scroller.appendChild(el('div', 'zip-head', `${files.length} 个文件${note ? ' · ' + note : ''} · 点击任意文件直接预览`));
  const list = el('ul', 'zip-list');
  for (const e of entries) {
    const li = el('li', e.dir ? 'z-dir' : 'z-file');
    li.append(el('span', null, e.dir ? '📁' : '📄'), el('span', null, e.name));
    if (!e.dir) {
      li.appendChild(el('span', 'z-size', fmtSize(e.size)));
      const parentRec = state.current;
      li.onclick = async () => {
        showLoading('解压中…');
        try {
          const blob = await e.getBlob();
          const inner = new File([blob], e.name.split('/').pop());
          const innerRec = { id: nextId++, name: inner.name, file: inner, parentZip: parentRec };
          await openRecord(innerRec);
          addSep();
          addAction('← 返回压缩包', () => openRecord(parentRec, { force: false }));
          addAction('解压此文件', () => downloadBlob(inner.name, blob));
        } finally {
          hideLoading();
        }
      };
    }
    list.appendChild(li);
  }
  scroller.appendChild(list);
  ui.viewer.appendChild(scroller);
}

/* 过滤 macOS 打包噪音：__MACOSX、.DS_Store、AppleDouble（._xxx） */
function isJunkEntry(name) {
  const clean = name.replace(/^\.\//, '');
  if (!clean || clean === '.') return true;
  return /(^|\/)(__MACOSX(\/|$)|\.DS_Store$|\._[^/]*$)/.test(clean);
}

async function viewZip(rec) {
  const zip = await JSZip.loadAsync(await rec.file.arrayBuffer());
  const entries = Object.values(zip.files)
    .filter(e => !isJunkEntry(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(e => ({
      name: e.name,
      dir: e.dir,
      size: e._data ? e._data.uncompressedSize : null,
      getBlob: () => e.async('blob'),
    }));
  renderArchiveList(entries);
  addRevealAction(rec);
}

function parseTar(bytes) {
  const entries = [];
  const dec = new TextDecoder();
  let off = 0;
  while (off + 512 <= bytes.length) {
    const block = bytes.subarray(off, off + 512);
    if (block.every(b => b === 0)) break;
    const name = dec.decode(block.subarray(0, 100)).replace(/\0.*$/, '');
    const prefix = dec.decode(block.subarray(345, 500)).replace(/\0.*$/, '');
    const size = parseInt(dec.decode(block.subarray(124, 136)).replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(block[156]);
    const full = (prefix ? prefix + '/' + name : name).replace(/^\.\//, '');
    const dataStart = off + 512;
    if (full && type !== 'x' && type !== 'g' && type !== 'L' && !isJunkEntry(full)) {
      entries.push({
        name: full,
        dir: type === '5' || full.endsWith('/'),
        size,
        getBlob: () => Promise.resolve(new Blob([bytes.subarray(dataStart, dataStart + size)])),
      });
    }
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function viewTar(rec, ext) {
  let bytes = new Uint8Array(await rec.file.arrayBuffer());
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (gzipped) {
    const { gunzipSync } = await import('../vendor/fflate.mjs');
    bytes = gunzipSync(bytes);
  }
  const isTar = ext === 'tar' || ext === 'tgz' || /\.tar\.gz$/i.test(rec.name) ||
    (bytes.length > 262 && new TextDecoder().decode(bytes.subarray(257, 262)) === 'ustar');
  if (isTar) {
    const entries = parseTar(bytes).sort((a, b) => a.name.localeCompare(b.name));
    if (!entries.length) throw new Error('空的或无法识别的 tar 包');
    renderArchiveList(entries, gzipped ? '已解压 gzip' : null);
  } else {
    // 单文件 .gz：解压后直接按内部文件打开
    const innerName = rec.name.replace(/\.gz$/i, '') || 'file';
    const inner = new File([bytes], innerName);
    const innerRec = { id: nextId++, name: innerName, file: inner };
    await openRecord(innerRec, { force: true });
    addSep();
    addAction('导出解压文件', () => downloadBlob(innerName, new Blob([bytes])));
    return;
  }
  addRevealAction(rec);
}

function viewUnsupportedArchive(rec, ext) {
  showInfo('📦', `暂不支持 .${ext} 压缩包`,
    '目前支持 ZIP、TAR、GZ、EPUB。RAR/7z 建议用 Keka（免费）解压后再拖进来。');
}

/* ============================== 3D ============================== */

async function view3D(rec, ext) {
  const THREE = await import('three');
  const stage = el('div', 'three-stage viewer-full');
  ui.viewer.appendChild(stage);
  stage.appendChild(el('div', 'three-hint', '拖动旋转 · 滚轮缩放 · 右键平移'));

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.insertBefore(renderer.domElement, stage.firstChild);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14151a);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
  const dir = new THREE.DirectionalLight(0xffffff, 2.4);
  dir.position.set(3, 6, 4);
  scene.add(dir);

  const { OrbitControls } = await import('../vendor/three/jsm/controls/OrbitControls.js');
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  let object;
  if (ext === 'stl') {
    const { STLLoader } = await import('../vendor/three/jsm/loaders/STLLoader.js');
    const geo = new STLLoader().parse(await rec.file.arrayBuffer());
    geo.computeVertexNormals();
    object = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb8bcc6, metalness: .15, roughness: .6 }));
  } else if (ext === 'obj') {
    const { OBJLoader } = await import('../vendor/three/jsm/loaders/OBJLoader.js');
    object = new OBJLoader().parse(await rec.file.text());
    object.traverse(n => { if (n.isMesh && !n.material) n.material = new THREE.MeshStandardMaterial({ color: 0xb8bcc6 }); });
  } else {
    const { GLTFLoader } = await import('../vendor/three/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    const buf = await rec.file.arrayBuffer();
    let gltf;
    try {
      gltf = await new Promise((res, rej) => loader.parse(buf, '', res, rej));
    } catch (e) {
      throw new Error('GLTF 解析失败（若引用了外部贴图/bin，请改用打包的 .glb）：' + (e.message || e));
    }
    object = gltf.scene;
  }
  scene.add(object);

  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  const radius = Math.max(size.x, size.y, size.z) || 1;
  camera.position.set(radius * 1.1, radius * 0.8, radius * 1.6);
  camera.near = radius / 100;
  camera.far = radius * 100;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);

  const grid = new THREE.GridHelper(radius * 4, 20, 0x333640, 0x24262c);
  grid.position.y = -size.y / 2;
  scene.add(grid);

  let alive = true;
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (w && h) {
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  (function loop() {
    if (!alive) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  })();
  state.cleanup = () => { alive = false; ro.disconnect(); renderer.dispose(); };
  addRevealAction(rec);
}

/* ============================== 字体 ============================== */

let fontSeq = 0;
async function viewFont(rec) {
  const buf = await rec.file.arrayBuffer();
  const family = 'LL_Font_' + (++fontSeq);
  const face = new FontFace(family, buf);
  await face.load();
  document.fonts.add(face);
  state.cleanup = () => document.fonts.delete(face);

  const scroller = el('div', 'viewer-full');
  scroller.style.cssText = 'overflow:auto;height:100%';
  const wrap = el('div', 'font-preview');
  const samples = {
    big: 'The quick brown fox jumps over the lazy dog',
    mid: '敏捷的棕色狐狸跳过懒惰的狗 0123456789',
    small: '仓颉造字，横竖撇捺。ABCDEFG abcdefg 12345',
  };
  for (const size of [64, 40, 28, 20, 15]) {
    const line = el('div', 'fp-line');
    line.appendChild(el('div', 'fp-size', size + 'px'));
    const t = el('div', null, size > 30 ? samples.big : size > 18 ? samples.mid : samples.small);
    t.style.cssText = `font-family:'${family}';font-size:${size}px`;
    line.appendChild(t);
    wrap.appendChild(line);
  }
  const custom = el('textarea', 'edit-ta');
  custom.value = '在这里输入文字，实时预览这款字体…';
  custom.style.cssText = `height:140px;margin-top:20px;border:1px solid var(--border);border-radius:8px;font-family:'${family}';font-size:24px`;
  wrap.appendChild(custom);
  scroller.appendChild(wrap);
  ui.viewer.appendChild(scroller);
  addRevealAction(rec);
}

/* ============================== HTML ============================== */

async function viewHTML(rec) {
  const { text } = await readText(rec);
  const frame = el('iframe', 'html-frame viewer-full');
  frame.setAttribute('sandbox', 'allow-same-origin'); // 默认禁脚本，安全预览
  frame.srcdoc = text;
  ui.viewer.appendChild(frame);

  let showingSrc = false;
  let srcWrap = null;
  const btn = addAction('查看源码', () => {
    showingSrc = !showingSrc;
    btn.textContent = showingSrc ? '查看渲染' : '查看源码';
    frame.hidden = showingSrc;
    if (showingSrc && !srcWrap) {
      srcWrap = el('div', 'code-wrap viewer-full');
      const pre = el('pre');
      const code = el('code', 'language-xml');
      code.textContent = text;
      pre.appendChild(code);
      srcWrap.appendChild(pre);
      ui.viewer.appendChild(srcWrap);
      try { hljs.highlightElement(code); } catch {}
    } else if (srcWrap) srcWrap.hidden = !showingSrc;
  });
  addAction('允许运行脚本', () => {
    frame.setAttribute('sandbox', 'allow-same-origin allow-scripts');
    frame.srcdoc = text;
    toast('已重新加载并允许脚本');
  }, { title: '默认禁止脚本，点击后放开' });
  addRevealAction(rec);
}

/* ============================== 未知格式 ============================== */

async function viewUnknown(rec) {
  const buf = await rec.file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    let ctrl = 0;
    const sampleLen = Math.min(text.length, 4000);
    for (let i = 0; i < sampleLen; i++) {
      const cc = text.charCodeAt(i);
      if (cc < 32 && cc !== 9 && cc !== 10 && cc !== 13) ctrl++;
    }
    if (sampleLen === 0 || ctrl / sampleLen < 0.02) return viewCode(rec, 'txt');
  } catch {}

  const LIMIT = 64 * 1024;
  const n = Math.min(bytes.length, LIMIT);
  const lines = [];
  for (let off = 0; off < n; off += 16) {
    const chunk = bytes.slice(off, off + 16);
    const hex = [...chunk].map(b => b.toString(16).padStart(2, '0')).join(' ').padEnd(47);
    const asc = [...chunk].map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('');
    lines.push(`<span class="hx-off">${off.toString(16).padStart(8, '0')}</span>  ${hex}  <span class="hx-asc">${asc.replace(/</g, '&lt;')}</span>`);
  }
  const wrap = el('div', 'hex-wrap viewer-full');
  wrap.innerHTML = (bytes.length > LIMIT ? `（二进制文件，仅显示前 64 KB / 共 ${fmtSize(bytes.length)}）\n\n` : '（未识别的二进制格式，十六进制查看）\n\n') + lines.join('\n');
  ui.viewer.appendChild(wrap);
  addRevealAction(rec);
}

/* ============================== 事件绑定 ============================== */

ui.input.onchange = () => {
  const items = [...ui.input.files].map(f => ({ file: f }));
  ui.input.value = '';
  addFiles(items);
};

$('#btn-open-sb').onclick = pickAndOpen;
$('#btn-open-big').onclick = e => { e.stopPropagation(); pickAndOpen(); };
$('#btn-home').onclick = async () => { if (await confirmDiscard()) goHome(); };
$('#dropzone').onclick = () => pickAndOpen();
$('#btn-sidebar').onclick = toggleSidebar;

function toggleSidebar() {
  document.body.classList.toggle('sb-closed');
  localStorage.setItem('locallens-sb', document.body.classList.contains('sb-closed') ? 'closed' : 'open');
}
if (localStorage.getItem('locallens-sb') === 'closed') document.body.classList.add('sb-closed');

/* 拖拽（支持文件与文件夹） */
let dragDepth = 0;
window.addEventListener('dragenter', e => {
  e.preventDefault();
  if (++dragDepth === 1) ui.dropOverlay.hidden = false;
});
window.addEventListener('dragleave', e => {
  e.preventDefault();
  if (--dragDepth <= 0) { dragDepth = 0; ui.dropOverlay.hidden = true; }
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => {
  e.preventDefault();
  dragDepth = 0;
  ui.dropOverlay.hidden = true;
  const items = [];
  if (e.dataTransfer.items && e.dataTransfer.items[0]?.getAsFileSystemHandle) {
    const handles = await Promise.all([...e.dataTransfer.items]
      .filter(i => i.kind === 'file')
      .map(i => i.getAsFileSystemHandle()));
    for (const h of handles) {
      if (!h) continue;
      await collectHandle(h, items);
    }
    if (items.length >= 300) toast('文件较多，本次载入前 300 个');
  }
  if (!items.length) {
    for (const f of e.dataTransfer.files) items.push({ file: f });
  }
  if (items.length) await addFiles(items);
});

/* 快捷键 */
window.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === 'o') { e.preventDefault(); pickAndOpen(); }
  if (mod && e.key === 's') { e.preventDefault(); if (state.editorGetValue) saveCurrent(); }
  if (mod && e.key === 'b') { e.preventDefault(); toggleSidebar(); }
  if (e.key === 'Escape' && state.current) { confirmDiscard().then(ok => ok && goHome()); }
});

window.addEventListener('beforeunload', e => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});

/* ============================== 启动：URL 直开 ============================== */

renderRecent();

(async function initFromQuery() {
  const p = new URLSearchParams(location.search);
  const rel = p.get('open');
  const abs = p.get('path');
  if (abs) {
    await openPath(abs);
    // 清掉地址栏参数，避免刷新时重复打开
    history.replaceState(null, '', location.pathname);
    return;
  }
  if (rel && !/^https?:/i.test(rel)) {
    try {
      const res = await fetch(rel);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const name = decodeURIComponent(rel.split('/').pop());
      await addFiles([{ file: new File([blob], name, { type: blob.type }) }]);
    } catch (err) {
      toast('无法打开 ' + rel + '：' + err.message, 4000);
    }
  }
})();
