/**
 * every-read — 渲染进程主逻辑。
 *
 * 组成：
 *  - Markdown 加载与拆块（lib/mdblocks.js + markdown-it）
 *  - 虚拟滚动模式：只挂载视口附近的条目，估算高度 + 实测校正
 *  - 分页模式：离屏测量块高 → 按页高贪心装箱 → 翻页/滚轮/键盘
 *  - 设置面板：自定义全局快捷键录入、不透明度、字号、置顶、共享隐身
 */
'use strict';

const els = {
  titlebar: document.getElementById('titlebar'),
  btnProtect: document.getElementById('btnProtect'),
  btnPin: document.getElementById('btnPin'),
  btnSettings: document.getElementById('btnSettings'),
  btnHide: document.getElementById('btnHide'),
  protectDot: document.getElementById('protectDot'),
  emptyState: document.getElementById('emptyState'),
  btnPickEmpty: document.getElementById('btnPickEmpty'),
  btnDemo: document.getElementById('btnDemo'),
  shortcutHint: document.getElementById('shortcutHint'),
  readerView: document.getElementById('readerView'),
  scrollViewport: document.getElementById('scrollViewport'),
  scrollContent: document.getElementById('scrollContent'),
  pageWrap: document.getElementById('pageWrap'),
  pageContent: document.getElementById('pageContent'),
  pagePrev: document.getElementById('pagePrev'),
  pageNext: document.getElementById('pageNext'),
  pageLabel: document.getElementById('pageLabel'),
  progressTrack: document.getElementById('progressTrack'),
  progressBar: document.getElementById('progressBar'),
  statusbar: document.getElementById('statusbar'),
  fileName: document.getElementById('fileName'),
  docStats: document.getElementById('docStats'),
  modeSeg: document.getElementById('modeSeg'),
  fontMinus: document.getElementById('fontMinus'),
  fontPlus: document.getElementById('fontPlus'),
  btnOpen: document.getElementById('btnOpen'),
  settingsModal: document.getElementById('settingsModal'),
  btnCloseSettings: document.getElementById('btnCloseSettings'),
  shortcutInput: document.getElementById('shortcutInput'),
  btnRecordShortcut: document.getElementById('btnRecordShortcut'),
  shortcutHint2: document.getElementById('shortcutHint2'),
  opacityRange: document.getElementById('opacityRange'),
  opacityVal: document.getElementById('opacityVal'),
  fontSizeRange: document.getElementById('fontSizeRange'),
  fontSizeVal: document.getElementById('fontSizeVal'),
  chkAlwaysOnTop: document.getElementById('chkAlwaysOnTop'),
  chkProtect: document.getElementById('chkProtect'),
  recentsList: document.getElementById('recentsList'),
  toasts: document.getElementById('toasts'),
  measureLayer: document.getElementById('measureLayer'),
};

const state = {
  mode: 'scroll',
  fontSize: 15,
  items: [],
  docChars: 0,
  filePath: null,
  fileName: null,
  positions: new Map(), // path → { scrollTop | page } 记忆阅读位置
  wheelAcc: 0,
  wheelLockUntil: 0,
};

/* ------------------------------------------------------------------ */
/* markdown-it                                                          */
/* ------------------------------------------------------------------ */

const md = window.markdownit({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
});
// 外链默认在新窗口打开
const defaultLinkOpen = md.renderer.rules.link_open
  || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';
  if (/^https?:/i.test(href)) token.attrSet('target', '_blank');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/* ------------------------------------------------------------------ */
/* Toast                                                                */
/* ------------------------------------------------------------------ */

function toast(message, type = 'info', ms = 2200) {
  if (!message) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  els.toasts.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ------------------------------------------------------------------ */
/* 虚拟滚动器：估算高度 + 挂载视口附近条目 + 实测校正                   */
/* ------------------------------------------------------------------ */

class VirtualScroller {
  constructor(viewport, content) {
    this.viewport = viewport;
    this.content = content;
    this.items = [];
    this.heights = [];
    this.offsets = [0];
    this.mounted = new Map();
    this._topVisible = 0;
    this._raf = 0;
    this.onRender = null;

    viewport.addEventListener('scroll', () => this.scheduleRender(), { passive: true });
    this.resizeObs = new ResizeObserver(() => this.scheduleRender());
    this.resizeObs.observe(viewport);
  }

  estimate(i) {
    const it = this.items[i];
    const chars = it && it.chars ? it.chars : 60;
    const base = 52 + chars * 0.62 * (state.fontSize / 15);
    return Math.max(56, Math.min(6000, base));
  }

  setItems(items) {
    this.clear();
    this.items = items;
    this.rebuildEstimates();
    this.viewport.scrollTop = 0;
    this.render();
  }

  clear() {
    for (const el of this.mounted.values()) el.remove();
    this.mounted.clear();
    this.items = [];
    this.heights = [];
    this.offsets = [0];
    this._topVisible = 0;
  }

  rebuildEstimates() {
    this.heights = this.items.map((_, i) => this.estimate(i));
    this.offsets = [0];
    for (let i = 0; i < this.heights.length; i++) {
      this.offsets.push(this.offsets[i] + this.heights[i]);
    }
    this.content.style.height = `${this.offsets[this.items.length]}px`;
  }

  /** 条目实测高度与估算不符时校正（单条 O(n) 更新前缀和，条目数最多数千，足够快） */
  updateHeights(i, actual) {
    if (i >= this.heights.length) return;
    if (Math.abs(actual - this.heights[i]) < 1.5) return;
    this.heights[i] = actual;
    for (let j = i; j < this.items.length; j++) {
      this.offsets[j + 1] = this.offsets[j] + this.heights[j];
    }
    this.content.style.height = `${this.offsets[this.items.length]}px`;
    for (const [idx, el] of this.mounted) {
      el.style.top = `${this.offsets[idx]}px`;
    }
  }

  /** 最大的 i 使 offsets[i] <= y */
  findIndexByY(y) {
    let lo = 0;
    let hi = this.items.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.offsets[mid] <= y) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  scheduleRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.render();
    });
  }

  render() {
    if (!this.items.length) return;
    const st = this.viewport.scrollTop;
    const vh = this.viewport.clientHeight;
    const start = this.findIndexByY(st);
    let end = start;
    while (end < this.items.length && this.offsets[end] < st + vh) end++;
    const from = Math.max(0, start - 3);
    const to = Math.min(this.items.length - 1, end + 3);

    for (let i = from; i <= to; i++) this.mountItem(i);
    for (const [i, el] of this.mounted) {
      if (i < from || i > to) {
        el.remove();
        this.mounted.delete(i);
      }
    }
    this._topVisible = start;
    if (this.onRender) this.onRender();
  }

  mountItem(i) {
    if (this.mounted.has(i)) return;
    const it = this.items[i];
    const el = document.createElement('div');
    el.className = 'md-item';
    el.innerHTML = it.html;
    el.style.top = `${this.offsets[i]}px`;
    el.dataset.measured = '1';
    this.content.appendChild(el);
    this.mounted.set(i, el);
    // 下一帧实测高度并校正
    requestAnimationFrame(() => {
      if (el.isConnected) this.updateHeights(i, el.offsetHeight);
    });
  }

  scrollToItem(i) {
    const idx = Math.max(0, Math.min(i, this.items.length - 1));
    this.viewport.scrollTop = this.offsets[idx] ?? 0;
    this.scheduleRender();
  }

  topVisibleItem() {
    return this._topVisible;
  }

  progress() {
    const max = this.viewport.scrollHeight - this.viewport.clientHeight;
    return max > 0 ? this.viewport.scrollTop / max : 0;
  }
}

const scroller = new VirtualScroller(els.scrollViewport, els.scrollContent);

/* ------------------------------------------------------------------ */
/* 分页器：离屏测量 → 贪心装箱 → 翻页                                  */
/* ------------------------------------------------------------------ */

const pager = {
  pages: [],
  current: 0,

  paginate() {
    // 宽度取内容区净宽（水平 padding 已移到 #pageWrap），高度扣除 pageContent 上下 padding
    const w = els.pageContent.clientWidth;
    const h = els.pageContent.clientHeight - 20; /* 8px top + 12px bottom */
    if (!w || !h) { this.pages = [[]]; return; }

    const ml = els.measureLayer;
    ml.style.width = `${w}px`;
    ml.innerHTML = '';
    const nodes = [];
    for (let i = 0; i < state.items.length; i++) {
      const d = document.createElement('div');
      d.className = 'md-item';
      d.innerHTML = state.items[i].html;
      ml.appendChild(d);
      nodes.push(d);
    }
    // 读取前缀偏移（此时强制一次布局）
    const heights = nodes.map((el) => el.offsetHeight);
    ml.innerHTML = '';

    const pages = [];
    let cur = [];
    let used = 0;
    for (let i = 0; i < state.items.length; i++) {
      const need = heights[i];
      if (cur.length && used + need > h) {
        pages.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(i);
      used += need;
    }
    if (cur.length) pages.push(cur);
    this.pages = pages.length ? pages : [[]];
  },

  show(idx) {
    if (!this.pages.length) this.pages = [[]];
    this.current = Math.max(0, Math.min(idx, this.pages.length - 1));
    els.pageContent.innerHTML = '';
    els.pageContent.scrollTop = 0;
    for (const i of this.pages[this.current]) {
      const d = document.createElement('div');
      d.className = 'md-item';
      d.innerHTML = state.items[i].html;
      els.pageContent.appendChild(d);
    }
    els.pageLabel.textContent = `${this.current + 1} / ${this.pages.length}`;
    updateProgress();
  },

  next() {
    if (this.current < this.pages.length - 1) this.show(this.current + 1);
    else toast('已经是最后一页了');
  },

  prev() {
    if (this.current > 0) this.show(this.current - 1);
    else toast('已经是第一页了');
  },

  firstItemOfCurrent() {
    const p = this.pages[this.current];
    return p && p.length ? p[0] : 0;
  },
};

/* ------------------------------------------------------------------ */
/* 模式切换（保留阅读位置锚点）                                        */
/* ------------------------------------------------------------------ */

function applyModeLayout() {
  const isScroll = state.mode === 'scroll';
  els.scrollViewport.hidden = !isScroll;
  els.pageWrap.hidden = isScroll;
  for (const btn of els.modeSeg.querySelectorAll('.seg-btn')) {
    btn.classList.toggle('active', btn.dataset.mode === state.mode);
  }
}

function switchMode(next, opts = {}) {
  if (next !== 'scroll' && next !== 'page') return;
  if (next === state.mode && !opts.force) return;

  // 记录当前锚点条目
  let anchor = 0;
  if (state.mode === 'scroll' && !opts.noAnchor) anchor = scroller.topVisibleItem();
  else if (state.mode === 'page' && !opts.noAnchor) anchor = pager.firstItemOfCurrent();

  state.mode = next;
  window.everyRead.updateConfig({ mode: next });
  applyModeLayout();

  if (next === 'scroll') {
    scroller.rebuildEstimates();
    scroller.scrollToItem(anchor);
    els.scrollViewport.focus({ preventScroll: true });
  } else {
    pager.paginate();
    const pi = pager.pages.findIndex((p) => p.includes(anchor));
    pager.show(Math.max(0, pi));
  }
}

/* ------------------------------------------------------------------ */
/* 文档加载                                                            */
/* ------------------------------------------------------------------ */

function savePosition() {
  if (!state.filePath) return;
  if (state.mode === 'scroll') {
    state.positions.set(state.filePath, { kind: 'scroll', value: scroller.viewport.scrollTop });
  } else {
    state.positions.set(state.filePath, { kind: 'page', value: pager.firstItemOfCurrent() });
  }
}

function loadFile(file) {
  if (!file || typeof file.content !== 'string') return;
  savePosition();

  state.items = window.EveryReadBlocks.buildVirtualItems(md, file.content);
  state.docChars = file.content.length;
  state.filePath = file.path || null;
  state.fileName = file.name || '未命名.md';

  els.emptyState.hidden = true;
  els.readerView.hidden = false;
  els.progressTrack.hidden = false;
  els.fileName.textContent = state.fileName;
  els.fileName.title = file.path || state.fileName;
  els.docStats.textContent = `${state.docChars.toLocaleString()} 字 · ${state.items.length} 块`;

  applyModeLayout();
  if (state.mode === 'scroll') {
    scroller.setItems(state.items);
  } else {
    pager.paginate();
    pager.show(0);
  }

  // 恢复记忆的阅读位置
  const saved = state.filePath ? state.positions.get(state.filePath) : null;
  if (saved) {
    if (state.mode === 'scroll' && saved.kind === 'scroll') {
      scroller.viewport.scrollTop = saved.value;
      scroller.scheduleRender();
    } else if (state.mode === 'page' && saved.kind === 'page') {
      const pi = pager.pages.findIndex((p) => p.includes(saved.value));
      pager.show(Math.max(0, pi));
    }
  }

  if (state.mode === 'scroll') els.scrollViewport.focus({ preventScroll: true });
  toast(`已加载：${state.fileName}（${state.items.length} 块）`, 'ok', 1600);
}

/* ------------------------------------------------------------------ */
/* 进度条                                                              */
/* ------------------------------------------------------------------ */

function updateProgress() {
  if (state.mode === 'scroll') {
    els.progressBar.style.width = `${Math.round(scroller.progress() * 100)}%`;
  } else {
    const total = Math.max(1, pager.pages.length);
    els.progressBar.style.width = `${Math.round(((pager.current + 1) / total) * 100)}%`;
  }
}
scroller.onRender = updateProgress;

/* ------------------------------------------------------------------ */
/* 打开文件：对话框 / 拖拽 / 最近文件                                  */
/* ------------------------------------------------------------------ */

const READABLE_EXT = new Set(['.md', '.markdown', '.mdown', '.mkd', '.txt']);

async function openViaDialog() {
  const res = await window.everyRead.openFileDialog();
  if (res.canceled) return;
  let loaded = 0;
  for (const f of res.files) {
    if (f.error) { toast(f.error, 'err'); continue; }
    loadFile(f);
    loaded++;
  }
  if (loaded > 1) toast(`已加载 ${loaded} 个文件，显示最后一个`, 'info');
}

async function handleDrop(fileList) {
  const files = [...fileList].filter((f) => READABLE_EXT.has(extOf(f.name)));
  if (!files.length) {
    toast('请拖入 .md / .markdown / .txt 文件', 'err');
    return;
  }
  for (const f of files) {
    try {
      const text = (await f.text()).replace(/^\uFEFF/, '');
      const p = window.everyRead.pathForFile(f);
      loadFile({ path: p || null, name: f.name, content: text });
      if (p) window.everyRead.recordRecent({ path: p, name: f.name });
    } catch (err) {
      toast(`读取失败：${f.name}（${err.message}）`, 'err');
    }
  }
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function bindDragDrop() {
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.emptyState.classList.add('drag-over');
  });
  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) els.emptyState.classList.remove('drag-over');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    els.emptyState.classList.remove('drag-over');
    if (e.dataTransfer && e.dataTransfer.files.length) handleDrop(e.dataTransfer.files);
  });
}

/* ------------------------------------------------------------------ */
/* 设置面板                                                            */
/* ------------------------------------------------------------------ */

function openSettings() {
  els.settingsModal.hidden = false;
  refreshSettings();
}

function closeSettings() {
  els.settingsModal.hidden = true;
  stopShortcutCapture();
}

async function refreshSettings() {
  const cfg = await window.everyRead.getConfig();
  els.shortcutInput.value = cfg.shortcutDisplay || cfg.shortcut || '';
  els.opacityRange.value = Math.round((cfg.opacity ?? 1) * 100);
  els.opacityVal.textContent = `${Math.round((cfg.opacity ?? 1) * 100)}%`;
  els.fontSizeRange.value = cfg.fontSize ?? 15;
  els.fontSizeVal.textContent = `${cfg.fontSize ?? 15}px`;
  els.chkAlwaysOnTop.checked = Boolean(cfg.alwaysOnTop);
  els.chkProtect.checked = Boolean(cfg.contentProtection);
  renderRecents(cfg.recents || []);
}

async function renderRecents(recents) {
  els.recentsList.innerHTML = '';
  if (!recents.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '暂无记录';
    els.recentsList.appendChild(li);
    return;
  }
  for (const r of recents) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'r-name';
    name.textContent = r.name;
    const p = document.createElement('span');
    p.className = 'r-path';
    p.textContent = r.path;
    p.title = r.path;
    const del = document.createElement('button');
    del.className = 'r-del';
    del.textContent = '✕';
    del.title = '从最近列表移除';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      const next = await window.everyRead.removeRecent(r.path);
      renderRecents(next);
    });
    li.append(name, p, del);
    li.addEventListener('click', async () => {
      const f = await window.everyRead.readFileByPath(r.path);
      if (f.error) { toast(f.error, 'err'); return; }
      loadFile(f);
      closeSettings();
    });
    els.recentsList.appendChild(li);
  }
}

/* ---------------- 快捷键录入 ---------------- */

let capturing = false;

function setShortcutHint(text, cls = '') {
  els.shortcutHint2.textContent = text;
  els.shortcutHint2.className = `field-hint ${cls}`;
}

function startShortcutCapture() {
  capturing = true;
  els.shortcutInput.classList.add('recording');
  els.shortcutInput.value = '请按下组合键…';
  els.btnRecordShortcut.textContent = '取消';
}

function stopShortcutCapture() {
  capturing = false;
  els.shortcutInput.classList.remove('recording');
  els.btnRecordShortcut.textContent = '录入';
  refreshSettings();
}

function keyToAcceleratorPart(e) {
  if (e.key === ' ') return 'Space';
  if (e.key === '+') return 'Plus';
  if (e.key.length === 1) return e.key.toUpperCase();
  const map = {
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    PageUp: 'PageUp', PageDown: 'PageDown', Escape: 'Escape',
  };
  return map[e.key] || e.key;
}

async function applyShortcutInput(input) {
  const res = await window.everyRead.setShortcut(input);
  if (res.ok) {
    els.shortcutInput.value = res.display;
    setShortcutHint(`已生效：${res.display}（全局按键，随时显隐）`, 'ok');
    toast(`快捷键已设置为 ${res.display}`, 'ok');
    els.shortcutHint.textContent = `按 ${res.display} 一键显隐`;
  } else {
    setShortcutHint(res.error || '设置失败', 'err');
    toast(res.error || '快捷键设置失败', 'err');
    // 失败时恢复显示当前生效的快捷键
    const cfg = await window.everyRead.getConfig();
    els.shortcutInput.value = cfg.shortcutDisplay || cfg.shortcut || '';
  }
  stopShortcutCapture();
}

function bindShortcutCapture() {
  els.btnRecordShortcut.addEventListener('click', () => {
    if (capturing) stopShortcutCapture();
    else {
      startShortcutCapture();
      setShortcutHint('正在录入：按下包含 Ctrl / Alt / Win 的组合键，或 F1-F24…');
      els.shortcutInput.focus();
    }
  });

  els.shortcutInput.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!capturing) return;
    if (e.key === 'Escape') { stopShortcutCapture(); return; }
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
      const held = [];
      if (e.ctrlKey || e.metaKey) held.push('Ctrl');
      if (e.altKey) held.push('Alt');
      if (e.shiftKey) held.push('Shift');
      els.shortcutInput.value = `${held.join('+') || ''}${held.length ? '+' : ''}…`;
      return;
    }
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    parts.push(keyToAcceleratorPart(e));
    applyShortcutInput(parts.join('+'));
  });
}

/* ---------------- 其他设置项 ---------------- */

function bindSettings() {
  els.btnSettings.addEventListener('click', openSettings);
  els.btnCloseSettings.addEventListener('click', closeSettings);
  els.settingsModal.addEventListener('click', (e) => {
    if (e.target === els.settingsModal) closeSettings();
  });

  let opacityThrottle = 0;
  els.opacityRange.addEventListener('input', () => {
    const v = Number(els.opacityRange.value) / 100;
    els.opacityVal.textContent = `${els.opacityRange.value}%`;
    const now = Date.now();
    if (now - opacityThrottle > 80) {
      opacityThrottle = now;
      window.everyRead.setOpacity(v);
    }
  });
  els.opacityRange.addEventListener('change', () => {
    window.everyRead.setOpacity(Number(els.opacityRange.value) / 100);
  });

  els.fontSizeRange.addEventListener('change', () => {
    applyFontSize(Number(els.fontSizeRange.value));
  });

  els.chkAlwaysOnTop.addEventListener('change', () => {
    window.everyRead.setAlwaysOnTop(els.chkAlwaysOnTop.checked);
  });
  els.chkProtect.addEventListener('change', () => {
    window.everyRead.setContentProtection(els.chkProtect.checked);
    toast(els.chkProtect.checked ? '屏幕共享隐身：已开启' : '屏幕共享隐身：已关闭', 'ok');
  });
}

/* ------------------------------------------------------------------ */
/* 字号                                                                */
/* ------------------------------------------------------------------ */

function applyFontSize(v) {
  const size = Math.max(12, Math.min(22, Number(v) || 15));
  state.fontSize = size;
  document.documentElement.style.setProperty('--fs', `${size}px`);
  els.fontSizeVal.textContent = `${size}px`;
  window.everyRead.updateConfig({ fontSize: size });
  if (state.items.length) {
    if (state.mode === 'scroll') {
      scroller.rebuildEstimates();
      scroller.scheduleRender();
    } else {
      const anchor = pager.firstItemOfCurrent();
      pager.paginate();
      const pi = pager.pages.findIndex((p) => p.includes(anchor));
      pager.show(Math.max(0, pi));
    }
  }
}

/* ------------------------------------------------------------------ */
/* 键盘 / 滚轮                                                         */
/* ------------------------------------------------------------------ */

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    // 设置面板打开时：Esc 关闭
    if (!els.settingsModal.hidden) {
      if (e.key === 'Escape') { closeSettings(); e.preventDefault(); }
      return;
    }
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (els.readerView.hidden) return; // 未打开文档时忽略

    if (state.mode === 'scroll') {
      if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
        e.preventDefault();
        els.scrollViewport.scrollBy({ top: els.scrollViewport.clientHeight * 0.85, behavior: 'auto' });
      } else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
        e.preventDefault();
        els.scrollViewport.scrollBy({ top: -els.scrollViewport.clientHeight * 0.85, behavior: 'auto' });
      }
      return;
    }

    // 分页模式
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
      e.preventDefault();
      pager.next();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
      e.preventDefault();
      pager.prev();
    } else if (e.key === 'Home') {
      e.preventDefault();
      pager.show(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      pager.show(pager.pages.length - 1);
    }
  });

  // 分页模式滚轮翻页（带阈值与节流，避免触控板误触）
  els.pageWrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now < state.wheelLockUntil) return;
    state.wheelAcc += e.deltaY;
    if (Math.abs(state.wheelAcc) >= 140) {
      const down = state.wheelAcc > 0;
      state.wheelAcc = 0;
      state.wheelLockUntil = now + 260;
      if (down) pager.next();
      else pager.prev();
    }
  }, { passive: false });
}

/* ------------------------------------------------------------------ */
/* 工具栏 / 状态栏绑定                                                 */
/* ------------------------------------------------------------------ */

function bindChrome() {
  els.btnOpen.addEventListener('click', openViaDialog);
  els.btnPickEmpty.addEventListener('click', openViaDialog);
  els.btnDemo.addEventListener('click', () => {
    loadFile({ path: null, name: '示例长文.md', content: buildDemoDoc() });
  });

  els.btnHide.addEventListener('click', () => window.everyRead.hideWindow());

  els.btnProtect.addEventListener('click', async () => {
    const st = await window.everyRead.windowState();
    await window.everyRead.setContentProtection(!st.contentProtection);
    toast(!st.contentProtection ? '屏幕共享隐身：已开启' : '屏幕共享隐身：已关闭', 'ok');
  });

  els.btnPin.addEventListener('click', async () => {
    const st = await window.everyRead.windowState();
    await window.everyRead.setAlwaysOnTop(!st.alwaysOnTop);
    toast(!st.alwaysOnTop ? '窗口置顶：已开启' : '窗口置顶：已关闭', 'ok');
  });

  els.modeSeg.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
  });

  els.fontMinus.addEventListener('click', () => applyFontSize(state.fontSize - 1));
  els.fontPlus.addEventListener('click', () => applyFontSize(state.fontSize + 1));

  els.pagePrev.addEventListener('click', () => pager.prev());
  els.pageNext.addEventListener('click', () => pager.next());

  bindDragDrop();
  bindSettings();
  bindShortcutCapture();
  bindKeyboard();

  // 窗口尺寸变化时，分页模式需要按新页高重排（保持锚点条目）
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.mode === 'page' && state.items.length) {
        const anchor = pager.firstItemOfCurrent();
        pager.paginate();
        const pi = pager.pages.findIndex((p) => p.includes(anchor));
        pager.show(Math.max(0, pi));
      }
    }, 250);
  });
}

/* ------------------------------------------------------------------ */
/* 配置同步                                                            */
/* ------------------------------------------------------------------ */

let lastAppliedSig = '';

function applyConfig(cfg) {
  if (!cfg) return;
  const sig = JSON.stringify([cfg.fontSize, cfg.mode, cfg.opacity, cfg.alwaysOnTop, cfg.contentProtection]);
  if (sig === lastAppliedSig) return;
  lastAppliedSig = sig;

  if (Number(cfg.fontSize) !== state.fontSize) applyFontSize(cfg.fontSize);
  if (cfg.mode && cfg.mode !== state.mode) switchMode(cfg.mode, { noAnchor: true, force: true });
  if (Number.isFinite(Number(cfg.opacity))) {
    els.opacityRange.value = Math.round(Number(cfg.opacity) * 100);
    els.opacityVal.textContent = `${Math.round(Number(cfg.opacity) * 100)}%`;
  }
  els.chkAlwaysOnTop.checked = Boolean(cfg.alwaysOnTop);
  els.chkProtect.checked = Boolean(cfg.contentProtection);
  els.btnPin.classList.toggle('active', Boolean(cfg.alwaysOnTop));
  els.protectDot.classList.toggle('on', Boolean(cfg.contentProtection));
  els.protectDot.title = `屏幕共享隐身：${cfg.contentProtection ? '开启' : '关闭'}`;
  if (cfg.shortcutDisplay) {
    els.shortcutHint.textContent = `按 ${cfg.shortcutDisplay} 一键显隐`;
    document.getElementById('shortcutHint2').textContent = `当前快捷键：${cfg.shortcutDisplay}`;
  }
}

/* ------------------------------------------------------------------ */
/* 示例长文                                                            */
/* ------------------------------------------------------------------ */

function buildDemoDoc() {
  const parts = ['# every-read 示例长文', '', '> 拖动顶部标题栏移动窗口；按全局快捷键一键显隐；底部可切换「滚动 / 分页」模式。', ''];
  const lorem = [
    '虚拟滚动模式只渲染视口附近的条目，几十万字的文档也能流畅浏览；滚动时先以估算高度占位，挂载后再用实测高度校正，避免跳动。',
    '分页模式把所有块按页高贪心装箱：标题永远另起新块，代码块独立成条，翻页时保留上一个模式的阅读位置。',
    '窗口支持置顶、调节不透明度，还能开启「屏幕共享隐身」——共享屏幕或录屏时窗口完全不可见。',
    '全局快捷键可在设置中自定义，需包含 Ctrl / Alt / Win 修饰键，或使用 F1-F24 单键。',
  ];
  const codeSample = '```js\n// every-read 虚拟滚动核心\nrender() {\n  const start = this.findIndexByY(this.viewport.scrollTop);\n  let end = start;\n  while (end < this.items.length && this.offsets[end] < st + vh) end++;\n  for (let i = Math.max(0, start - 3); i <= Math.min(this.items.length - 1, end + 3); i++) {\n    this.mountItem(i); // 视口 ± 3 条，其余卸载\n  }\n}\n```';
  for (let i = 1; i <= 120; i++) {
    parts.push(`## 第 ${i} 节 · 一直在渲染，从未被 scrolling 卡住`);
    parts.push('');
    parts.push(lorem[i % lorem.length]);
    parts.push('');
    if (i % 3 === 0) { parts.push(codeSample); parts.push(''); }
    if (i % 4 === 0) {
      parts.push('| 模式 | 适合场景 | 内存占用 |');
      parts.push('| --- | --- | --- |');
      parts.push('| 虚拟滚动 | 长文连续阅读 | 只挂载视口条目 |');
      parts.push('| 分页 | 逐屏精读、演示 | 当前页 |');
      parts.push('');
    }
    if (i % 5 === 0) {
      parts.push('- 快捷键：`Ctrl+Shift+Y`（默认，可自定义）');
      parts.push('- 拖拽 .md 文件到窗口即可打开');
      parts.push('- `A−` / `A+` 调整字号');
      parts.push('');
    }
    if (i % 7 === 0) { parts.push('---'); parts.push(''); }
  }
  return parts.join('\n');
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  bindChrome();
  const cfg = await window.everyRead.getConfig();
  state.mode = cfg.mode === 'page' ? 'page' : 'scroll';
  state.fontSize = Number(cfg.fontSize) || 15;
  document.documentElement.style.setProperty('--fs', `${state.fontSize}px`);
  applyModeLayout();
  applyConfig(cfg);

  window.everyRead.onConfigUpdated(applyConfig);
  window.everyRead.onOpenSettings(openSettings);

  // 记住上次的文件（可选恢复：放入最近列表，点击即读）
  if (Array.isArray(cfg.recents) && cfg.recents.length) {
    const last = cfg.recents[0];
    els.shortcutHint.textContent = `按 ${cfg.shortcutDisplay} 一键显隐 · 上次：${last.name}（设置里可重新打开）`;
  }
  refreshSettings();

  console.log('[every-read] renderer booted, mode =', state.mode);
}

boot();
