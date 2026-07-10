/* LocalLens — 本地万能文件预览与编辑
 * 纯前端实现：所有解析、渲染都发生在本机浏览器里，不发出任何网络请求。
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
  files: [],        // { id, name, file, handle?, parentZip? }
  current: null,    // 当前文件记录
  dirty: false,
  editorGetValue: null, // 编辑模式下取当前文本
  cleanup: null,        // 切换文件时的清理钩子（如 three.js 循环、object URL）
};
let nextId = 1;

const ui = {
  toolbar: $('#toolbar'),
  actions: $('#tb-actions'),
  fileName: $('#file-name'),
  dirtyDot: $('#dirty-dot'),
  home: $('#home'),
  viewer: $('#viewer'),
  fileList: $('#file-list'),
  dropOverlay: $('#drop-overlay'),
  toast: $('#toast'),
  input: $('#file-input'),
};

function toast(msg, ms = 2600) {
  ui.toast.textContent = msg;
  ui.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (ui.toast.hidden = true), ms);
}

function setDirty(v) {
  state.dirty = v;
  ui.dirtyDot.hidden = !v;
}

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

function fmtSize(n) {
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
}

/* ============================== 文件管理 ============================== */

async function addFiles(items) {
  let first = null;
  for (const it of items) {
    const rec = { id: nextId++, name: it.file.name, file: it.file, handle: it.handle || null };
    state.files.push(rec);
    if (!first) first = rec;
  }
  renderFileList();
  if (first) await openRecord(first);
}

function renderFileList() {
  ui.fileList.innerHTML = '';
  for (const rec of state.files) {
    const li = el('li');
    li.classList.toggle('active', state.current === rec);
    const ext = el('span', 'fl-ext', extOf(rec.name) || 'file');
    li.append(ext, document.createTextNode(rec.name));
    li.title = rec.name;
    li.onclick = () => openRecord(rec);
    ui.fileList.appendChild(li);
  }
}

async function confirmDiscard() {
  if (!state.dirty) return true;
  return confirm('当前文件有未保存的修改，确定丢弃吗？');
}

async function openRecord(rec) {
  if (rec !== state.current && !(await confirmDiscard())) return;
  if (state.cleanup) { try { state.cleanup(); } catch {} state.cleanup = null; }
  state.current = rec;
  state.editorGetValue = null;
  setDirty(false);

  ui.home.hidden = true;
  ui.viewer.hidden = false;
  ui.viewer.innerHTML = '';
  ui.actions.innerHTML = '';
  ui.fileName.textContent = rec.name + '  ·  ' + fmtSize(rec.file.size);
  document.body.classList.add('immersive');
  renderFileList();

  const ext = extOf(rec.name);
  const viewer = pickViewer(ext, rec.file.type);
  try {
    await viewer(rec, ext);
  } catch (err) {
    console.error('[LocalLens]', err);
    showInfo('⚠️', `打开失败：${err.message || err}`);
  }
}

function goHome() {
  if (state.cleanup) { try { state.cleanup(); } catch {} state.cleanup = null; }
  state.current = null;
  setDirty(false);
  ui.viewer.hidden = true;
  ui.viewer.innerHTML = '';
  ui.actions.innerHTML = '';
  ui.fileName.textContent = '';
  ui.home.hidden = false;
  document.body.classList.remove('immersive');
  renderFileList();
}

function showInfo(icon, text, extra) {
  const box = el('div', 'center-info');
  box.append(el('div', 'big', icon), el('div', null, text));
  if (extra) box.append(extra);
  ui.viewer.appendChild(box);
}

/* ============================== 保存 ============================== */

async function saveCurrent() {
  const rec = state.current;
  if (!rec || !state.editorGetValue) return;
  const text = state.editorGetValue();
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
      console.warn('[LocalLens] 直接写入失败，降级为另存', err);
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
      rec.name = handle.name || rec.name;
      rec.file = new File([content], rec.name, { type: rec.file.type });
      setDirty(false);
      renderFileList();
      ui.fileName.textContent = rec.name + '  ·  ' + fmtSize(rec.file.size);
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

/* ============================== 格式路由 ============================== */

const EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'],
  pdf: ['pdf'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'weba'],
  markdown: ['md', 'markdown', 'mdown', 'mkd'],
  html: ['html', 'htm', 'xhtml'],
  sheet: ['xlsx', 'xls', 'xlsm', 'ods'],
  csv: ['csv', 'tsv'],
  docx: ['docx'],
  zip: ['zip', 'epub', 'cbz', 'jar', 'apk', 'xpi', 'crx', 'ipa'],
  model3d: ['glb', 'gltf', 'obj', 'stl'],
  font: ['ttf', 'otf', 'woff', 'woff2'],
  json: ['json', 'jsonl', 'geojson', 'ipynb', 'webmanifest'],
  yaml: ['yaml', 'yml'],
};

const CODE_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', py: 'python', rb: 'ruby', go: 'go',
  rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash',
  zsh: 'bash', bash: 'bash', fish: 'bash', sql: 'sql', css: 'css',
  scss: 'scss', less: 'less', xml: 'xml', svgsrc: 'xml', toml: 'ini',
  ini: 'ini', conf: 'ini', properties: 'ini', env: 'bash', lua: 'lua',
  r: 'r', pl: 'perl', dart: 'dart', gradle: 'groovy', groovy: 'groovy',
  vue: 'xml', svelte: 'xml', dockerfile: 'dockerfile', makefile: 'makefile',
  txt: 'plaintext', log: 'plaintext', text: 'plaintext', gitignore: 'plaintext',
  lock: 'plaintext', srt: 'plaintext', vtt: 'plaintext',
};

function pickViewer(ext, mime) {
  if (EXT.image.includes(ext)) return viewImage;
  if (EXT.pdf.includes(ext)) return viewPDF;
  if (EXT.video.includes(ext)) return viewVideo;
  if (EXT.audio.includes(ext)) return viewAudio;
  if (EXT.markdown.includes(ext)) return viewMarkdown;
  if (EXT.html.includes(ext)) return viewHTML;
  if (EXT.sheet.includes(ext)) return viewSheet;
  if (EXT.csv.includes(ext)) return viewCSV;
  if (EXT.docx.includes(ext)) return viewDocx;
  if (EXT.zip.includes(ext)) return viewZip;
  if (EXT.model3d.includes(ext)) return view3D;
  if (EXT.font.includes(ext)) return viewFont;
  if (EXT.json.includes(ext)) return viewJSON;
  if (EXT.yaml.includes(ext)) return viewYAML;
  if (ext in CODE_LANG) return viewCode;
  if (mime && mime.startsWith('text/')) return viewCode;
  if (mime && mime.startsWith('image/')) return viewImage;
  if (mime && mime.startsWith('video/')) return viewVideo;
  if (mime && mime.startsWith('audio/')) return viewAudio;
  return viewUnknown;
}

/* ============================== 查看器：图片 ============================== */

async function viewImage(rec, ext) {
  const url = URL.createObjectURL(rec.file);
  state.cleanup = () => URL.revokeObjectURL(url);

  const stage = el('div', 'img-stage viewer-full');
  const img = el('img');
  img.src = url;
  stage.appendChild(img);
  ui.viewer.appendChild(stage);

  await img.decode().catch(() => {});
  const nw = img.naturalWidth, nh = img.naturalHeight;
  ui.fileName.textContent = `${rec.name} · ${nw}×${nh} · ${fmtSize(rec.file.size)}`;

  let zoom = 0; // 0 = 自适应
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

  addAction('适应窗口', () => { zoom = 0; apply(); });
  addAction('100%', () => { zoom = 1; apply(); });
  addAction('＋', () => { zoom = (zoom || 1) * 1.25; apply(); });
  addAction('－', () => { zoom = Math.max(0.05, (zoom || 1) / 1.25); apply(); });
  addSep();

  const rasterize = async (type, name) => {
    const canvas = el('canvas');
    canvas.width = nw; canvas.height = nh;
    const ctx = canvas.getContext('2d');
    if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, nw, nh); }
    ctx.drawImage(img, 0, 0);
    canvas.toBlob(b => b ? downloadBlob(name, b) : toast('转换失败'), type, 0.92);
  };
  const base = rec.name.replace(/\.[^.]+$/, '');
  if (ext !== 'png') addAction('转 PNG', () => rasterize('image/png', base + '.png'));
  if (ext !== 'jpg' && ext !== 'jpeg') addAction('转 JPG', () => rasterize('image/jpeg', base + '.jpg'));
}

/* ============================== 查看器：PDF ============================== */

async function viewPDF(rec) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

  const data = await rec.file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  ui.fileName.textContent = `${rec.name} · ${doc.numPages} 页 · ${fmtSize(rec.file.size)}`;

  const scroll = el('div', 'pdf-scroll viewer-full');
  ui.viewer.appendChild(scroll);

  let scale = 0; // 0 = 适应宽度
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
    downloadBlob(rec.name.replace(/\.pdf$/i, '') + '.txt', new Blob([parts.join('\n\n')], { type: 'text/plain' }));
  }, { title: '把 PDF 文字层导出为 .txt' });

  state.cleanup = () => { renderToken++; doc.destroy(); };
  await renderAll();
}

/* ============================== 查看器：音视频 ============================== */

async function viewVideo(rec) {
  const url = URL.createObjectURL(rec.file);
  state.cleanup = () => URL.revokeObjectURL(url);
  const stage = el('div', 'media-stage viewer-full');
  const v = el('video');
  v.src = url; v.controls = true; v.autoplay = false;
  stage.appendChild(v);
  ui.viewer.appendChild(stage);
  v.onerror = () => showInfo('🎬', '浏览器无法解码这个视频编码（如 HEVC/MKV 内的部分编码）。');
  addAction('截取当前帧', () => {
    if (!v.videoWidth) return toast('请先播放到想截取的画面');
    const c = el('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(b => b && downloadBlob(rec.name.replace(/\.[^.]+$/, '') + '_frame.png', b), 'image/png');
  });
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
}

/* ============================== 查看器：Markdown ============================== */

marked.setOptions({ gfm: true, breaks: false });

function renderMarkdownInto(container, text) {
  container.innerHTML = marked.parse(text);
  container.querySelectorAll('pre code').forEach(b => { try { hljs.highlightElement(b); } catch {} });
  // 本地工具里外链一律新窗口打开
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
  let text = await rec.file.text();
  let editing = false;

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

  let raf = null;
  ta.oninput = () => {
    setDirty(true);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => renderMarkdownInto(inner, ta.value));
  };

  const btnEdit = addAction('编辑', () => {
    editing = !editing;
    ta.hidden = !editing;
    split.classList.toggle('single', !editing);
    btnEdit.textContent = editing ? '完成' : '编辑';
    if (editing) ta.focus();
  });
  addAction('保存', saveCurrent, { primary: true, title: '⌘S · 直接写回原文件' });
  addAction('另存为', () => saveAs());
  addSep();
  addAction('导出 HTML', () => downloadBlob(rec.name.replace(/\.[^.]+$/, '') + '.html',
    new Blob([mdExportHTML(rec.name, ta.value)], { type: 'text/html' })));
  addAction('打印 / 存 PDF', () => printHTML(mdExportHTML(rec.name, ta.value)));
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

/* ============================== 查看器：代码 / 纯文本 ============================== */

async function viewCode(rec, ext) {
  const text = await rec.file.text();
  const name = rec.name.toLowerCase();
  let lang = CODE_LANG[ext] || 'plaintext';
  if (name === 'dockerfile') lang = 'dockerfile';
  if (name === 'makefile') lang = 'makefile';

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

  let editing = false;
  const btnEdit = addAction('编辑', () => {
    editing = !editing;
    wrap.hidden = editing;
    ta.hidden = !editing;
    btnEdit.textContent = editing ? '预览' : '编辑';
    if (editing) ta.focus();
    else { code.textContent = ta.value; code.removeAttribute('data-highlighted'); try { hljs.highlightElement(code); } catch {} }
  });
  addAction('保存', saveCurrent, { primary: true, title: '⌘S' });
  addAction('另存为', () => saveAs());
  addSep();
  addAction('复制全文', async () => { await navigator.clipboard.writeText(ta.value); toast('已复制到剪贴板'); });
  ui.fileName.textContent = `${rec.name} · ${text.split('\n').length} 行 · ${fmtSize(rec.file.size)}`;
}

/* ============================== 查看器：JSON / YAML ============================== */

async function viewJSON(rec, ext) {
  const raw = await rec.file.text();
  let parsed = null, pretty = raw;
  try {
    if (ext === 'jsonl') {
      parsed = raw.trim().split('\n').map(l => JSON.parse(l));
      pretty = JSON.stringify(parsed, null, 2);
    } else {
      parsed = JSON.parse(raw);
      pretty = JSON.stringify(parsed, null, 2);
    }
  } catch (e) {
    toast('JSON 解析失败，按纯文本显示：' + e.message, 4000);
  }
  rec.file = new File([raw], rec.name, { type: 'application/json' });
  await viewCodeText(rec, pretty, 'json');
  if (parsed != null) {
    addSep();
    addAction('转 YAML', () => downloadBlob(rec.name.replace(/\.[^.]+$/, '') + '.yaml',
      new Blob([yamlDump(parsed)], { type: 'text/yaml' })));
    addAction('压缩(minify)', () => downloadBlob(rec.name.replace(/\.[^.]+$/, '') + '.min.json',
      new Blob([JSON.stringify(parsed)], { type: 'application/json' })));
  }
}

async function viewYAML(rec) {
  const raw = await rec.file.text();
  await viewCodeText(rec, raw, 'yaml');
  try {
    const parsed = yamlLoad(raw);
    addSep();
    addAction('转 JSON', () => downloadBlob(rec.name.replace(/\.[^.]+$/, '') + '.json',
      new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' })));
  } catch {}
}

/** 与 viewCode 相同的外壳，但内容由调用方给出（用于 JSON 美化后的文本） */
async function viewCodeText(rec, text, lang) {
  const fake = { ...rec, file: new File([text], rec.name) };
  fake.file = new File([text], rec.name);
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

  let editing = false;
  const btnEdit = addAction('编辑', () => {
    editing = !editing;
    wrap.hidden = editing;
    ta.hidden = !editing;
    btnEdit.textContent = editing ? '预览' : '编辑';
    if (editing) ta.focus();
    else { code.textContent = ta.value; code.removeAttribute('data-highlighted'); try { hljs.highlightElement(code); } catch {} }
  });
  addAction('保存', saveCurrent, { primary: true, title: '⌘S' });
  addAction('另存为', () => saveAs());
}

/* ============================== 查看器：CSV / Excel ============================== */

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
      const cellEl = el(r === 0 ? 'th' : 'td', null, String(rows[r][c] ?? ''));
      tr.appendChild(cellEl);
    }
    table.appendChild(tr);
  }
  scroll.appendChild(table);
  container.appendChild(scroll);
  const msgs = [];
  if (rows.length > MAX_ROWS) msgs.push(`共 ${rows.length} 行，仅显示前 ${MAX_ROWS} 行`);
  if (note) msgs.push(note);
  if (msgs.length) container.insertBefore(el('div', 'table-note', msgs.join(' · ')), scroll);
}

async function viewCSV(rec, ext) {
  const text = await rec.file.text();
  const rows = parseCSV(text, ext === 'tsv' ? '\t' : ',');
  const wrap = el('div', 'viewer-full');
  wrap.style.cssText = 'display:flex;flex-direction:column;height:100%';
  ui.viewer.appendChild(wrap);
  renderTable(wrap, rows);
  ui.fileName.textContent = `${rec.name} · ${rows.length} 行 × ${rows[0]?.length || 0} 列 · ${fmtSize(rec.file.size)}`;

  const base = rec.name.replace(/\.[^.]+$/, '');
  addAction('转 JSON', () => {
    const [head, ...body] = rows;
    const objs = body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
    downloadBlob(base + '.json', new Blob([JSON.stringify(objs, null, 2)], { type: 'application/json' }));
  });
  addAction('转 Excel', () => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, base + '.xlsx');
  });
}

async function viewSheet(rec) {
  const buf = await rec.file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const wrap = el('div', 'viewer-full');
  wrap.style.cssText = 'display:flex;flex-direction:column;height:100%';
  const tabs = el('div', 'sheet-tabs');
  const body = el('div');
  body.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column';
  wrap.append(tabs, body);
  ui.viewer.appendChild(wrap);

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
  ui.fileName.textContent = `${rec.name} · ${wb.SheetNames.length} 个工作表 · ${fmtSize(rec.file.size)}`;

  const base = rec.name.replace(/\.[^.]+$/, '');
  addAction('当前表转 CSV', () => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[activeSheet]);
    downloadBlob(`${base}_${activeSheet}.csv`, new Blob(['﻿' + csv], { type: 'text/csv' }));
  });
  addAction('当前表转 JSON', () => {
    const objs = XLSX.utils.sheet_to_json(wb.Sheets[activeSheet], { defval: '' });
    downloadBlob(`${base}_${activeSheet}.json`, new Blob([JSON.stringify(objs, null, 2)], { type: 'application/json' }));
  });
}

/* ============================== 查看器：Word ============================== */

async function viewDocx(rec) {
  const buf = await rec.file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer: buf });
  const pad = el('div', 'viewer-pad doc-render');
  pad.innerHTML = result.value || '<p>（空文档）</p>';
  const scroller = el('div', 'viewer-full');
  scroller.style.overflow = 'auto';
  scroller.style.height = '100%';
  scroller.appendChild(pad);
  ui.viewer.appendChild(scroller);

  const base = rec.name.replace(/\.[^.]+$/, '');
  addAction('导出 HTML', () => downloadBlob(base + '.html',
    new Blob([`<!DOCTYPE html><meta charset="utf-8"><title>${rec.name}</title><body style="max-width:820px;margin:40px auto;font-family:-apple-system,'PingFang SC',sans-serif;line-height:1.75">${result.value}</body>`], { type: 'text/html' })));
  addAction('提取纯文本', async () => {
    const t = await mammoth.extractRawText({ arrayBuffer: buf });
    downloadBlob(base + '.txt', new Blob([t.value], { type: 'text/plain' }));
  });
  addAction('打印 / 存 PDF', () => printHTML(`<!DOCTYPE html><meta charset="utf-8"><body style="font-family:-apple-system,'PingFang SC',sans-serif;line-height:1.7">${result.value}</body>`));
}

/* ============================== 查看器：压缩包 ============================== */

async function viewZip(rec) {
  const zip = await JSZip.loadAsync(await rec.file.arrayBuffer());
  const entries = Object.values(zip.files)
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter(e => !e.dir);

  const scroller = el('div', 'viewer-full');
  scroller.style.cssText = 'overflow:auto;height:100%';
  const head = el('div', 'zip-head', `${files.length} 个文件 · 点击任意文件直接预览`);
  const list = el('ul', 'zip-list');
  for (const e of entries) {
    const li = el('li', e.dir ? 'z-dir' : 'z-file');
    li.append(
      el('span', null, e.dir ? '📁' : '📄'),
      el('span', null, e.name),
    );
    if (!e.dir) {
      const sz = e._data && e._data.uncompressedSize >= 0 ? fmtSize(e._data.uncompressedSize) : '';
      li.appendChild(el('span', 'z-size', sz));
      li.onclick = async () => {
        toast('解压中…', 1200);
        const blob = await e.async('blob');
        const inner = new File([blob], e.name.split('/').pop(), {});
        const innerRec = { id: nextId++, name: inner.name, file: inner, parentZip: rec };
        await openRecord(innerRec);
        addSep();
        addAction('← 返回压缩包', () => openRecord(rec));
        addAction('解压此文件', () => downloadBlob(inner.name, blob));
      };
    }
    list.appendChild(li);
  }
  scroller.append(head, list);
  ui.viewer.appendChild(scroller);
}

/* ============================== 查看器：3D ============================== */

async function view3D(rec, ext) {
  const THREE = await import('three');
  const stage = el('div', 'three-stage viewer-full');
  ui.viewer.appendChild(stage);
  stage.appendChild(el('div', 'three-hint', '拖动旋转 · 滚轮缩放 · 右键平移'));

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.insertBefore(renderer.domElement, stage.firstChild);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x16171b);
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
    const gltf = await new Promise((res, rej) => loader.parse(buf, '', res, rej));
    object = gltf.scene;
  }
  scene.add(object);

  // 居中并取景
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
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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
}

/* ============================== 查看器：字体 ============================== */

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
  const samples = [
    'The quick brown fox jumps over the lazy dog',
    '敏捷的棕色狐狸跳过懒惰的狗 0123456789',
    'AaBbCcDdEeFfGg HhIiJjKkLlMm',
    '仓颉造字，鬼夜哭。汉字之美，横竖撇捺。',
  ];
  for (const size of [64, 40, 28, 20, 15]) {
    const line = el('div', 'fp-line');
    line.appendChild(el('div', 'fp-size', size + 'px'));
    const t = el('div', null, samples[size > 30 ? 0 : size > 18 ? 1 : 3]);
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
}

/* ============================== 查看器：HTML ============================== */

async function viewHTML(rec) {
  const text = await rec.file.text();
  const frame = el('iframe', 'html-frame viewer-full');
  frame.setAttribute('sandbox', 'allow-same-origin'); // 不执行脚本，安全预览
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
}

/* ============================== 查看器：未知（十六进制 / 文本嗅探） ============================== */

async function viewUnknown(rec) {
  const buf = await rec.file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // 尝试按 UTF-8 严格解码，成功且可打印比例高则按文本显示
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
}

/* ============================== 打开入口 ============================== */

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
      // 不支持或被拒绝时退回 <input>
    }
  }
  ui.input.click();
}

ui.input.onchange = () => {
  const items = [...ui.input.files].map(f => ({ file: f }));
  ui.input.value = '';
  addFiles(items);
};

$('#btn-open').onclick = pickAndOpen;
$('#btn-open-big').onclick = pickAndOpen;
$('#btn-home').onclick = async () => { if (await confirmDiscard()) goHome(); };
$('#dropzone').onclick = e => { if (e.target.tagName !== 'BUTTON') pickAndOpen(); };

/* 拖拽 */
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
    // Chrome：拿 handle，之后可以直接写回保存
    const handles = await Promise.all([...e.dataTransfer.items]
      .filter(i => i.kind === 'file')
      .map(i => i.getAsFileSystemHandle()));
    for (const h of handles) {
      if (h?.kind === 'file') items.push({ file: await h.getFile(), handle: h });
    }
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
  if (e.key === 'Escape' && state.current) { confirmDiscard().then(ok => ok && goHome()); }
});

/* 顶栏自动显隐：鼠标靠近顶部 40px 时浮现 */
window.addEventListener('mousemove', e => {
  document.body.classList.toggle('reveal-top', e.clientY < 40);
});
/* 侧栏：左缘悬停浮现 */
const hot = $('#sidebar-hotzone');
const sb = $('#sidebar');
hot.addEventListener('mouseenter', () => document.body.classList.add('sb-open'));
sb.addEventListener('mouseleave', () => document.body.classList.remove('sb-open'));

window.addEventListener('beforeunload', e => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});

/* ============================== URL 直开（用于示例与自测） ============================== */

(async function initFromQuery() {
  const p = new URLSearchParams(location.search);
  const target = p.get('open');
  if (!target || /^https?:/i.test(target)) return; // 只允许同目录相对路径
  try {
    const res = await fetch(target);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const name = decodeURIComponent(target.split('/').pop());
    await addFiles([{ file: new File([blob], name, { type: blob.type }) }]);
  } catch (err) {
    toast('无法打开 ' + target + '：' + err.message, 4000);
  }
})();
