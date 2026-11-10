/**
 * every-read — Electron 主进程。
 *
 * 核心职责（参照 inter-assistant desktop/main.js 的实现思路）：
 *  1. 无边框悬浮窗（skipTaskbar + 可置顶 + 可选屏幕共享隐身）
 *  2. 全局快捷键一键显隐（可自定义，失败可回退提示）
 *  3. 系统托盘
 *  4. Markdown 文件读取 / 最近文件 / 配置持久化
 */
'use strict';

const {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  dialog,
  screen,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { normalizeAccelerator, toDisplay } = require('./lib/shortcuts');
const { buildIconPng } = require('./lib/icon');

const APP_NAME = 'every-read';
let configFilePath = '';
let win = null;
let tray = null;
let currentAccelerator = null;
let boundsSaveTimer = null;

const DEFAULT_CONFIG = {
  shortcut: 'CommandOrControl+Shift+Y',
  opacity: 1,
  fontSize: 15,
  mode: 'scroll',
  contentProtection: true,
  alwaysOnTop: true,
  bounds: null,
  recents: [],
  lastFile: null,
};

let cfg = { ...DEFAULT_CONFIG };

function loadConfig() {
  try {
    const raw = fs.readFileSync(configFilePath, 'utf8');
    const data = JSON.parse(raw);
    cfg = {
      ...DEFAULT_CONFIG,
      ...data,
      recents: Array.isArray(data.recents) ? data.recents.slice(0, 10) : [],
    };
  } catch {
    cfg = { ...DEFAULT_CONFIG };
  }
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configFilePath), { recursive: true });
    fs.writeFileSync(configFilePath, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.warn('[config] save failed:', err.message);
  }
}

function clampOpacity(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0.2, n));
}

function configWithDisplay() {
  return { ...cfg, shortcutDisplay: toDisplay(cfg.shortcut, process.platform) };
}

function broadcastConfig() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('config-updated', configWithDisplay());
  }
  rebuildTrayMenu();
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function loadAppIcon() {
  try {
    const p = path.join(__dirname, 'assets', 'icon.png');
    if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  } catch { /* ignore */ }
  try {
    return nativeImage.createFromBuffer(buildIconPng(64));
  } catch {
    return undefined;
  }
}

function boundsOnScreen(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every((n) => Number.isFinite(n) && n > 0)) return null;
  const intersects = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return x < a.x + a.width - 60 && x + width > a.x + 60
      && y < a.y + a.height - 40 && y + height > a.y + 40;
  });
  return intersects ? { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) } : null;
}

function createWindow() {
  const bounds = boundsOnScreen(cfg.bounds);
  win = new BrowserWindow({
    width: bounds?.width ?? 980,
    height: bounds?.height ?? 640,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 420,
    minHeight: 300,
    frame: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: '#0f1317',
    title: APP_NAME,
    ...(loadAppIcon() ? { icon: loadAppIcon() } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.setAlwaysOnTop(Boolean(cfg.alwaysOnTop), 'floating');
  win.setContentProtection(Boolean(cfg.contentProtection));
  win.setOpacity(clampOpacity(cfg.opacity));

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.on('resize', scheduleBoundsSave);
  win.on('move', scheduleBoundsSave);
  win.on('close', () => { /* 由 app 生命周期统一管理 */ });
  win.on('closed', () => { win = null; });
}

function scheduleBoundsSave() {
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    boundsSaveTimer = null;
    if (!win || win.isDestroyed()) return;
    cfg.bounds = win.getBounds();
    saveConfig();
  }, 300);
}

// ---------------------------------------------------------------------------
// Global shortcut（一键显隐）
// ---------------------------------------------------------------------------

function applyShortcut(accelerator) {
  if (currentAccelerator) {
    try { globalShortcut.unregister(currentAccelerator); } catch { /* ignore */ }
    currentAccelerator = null;
  }
  try {
    const ok = globalShortcut.register(accelerator, toggleWindow);
    if (ok) currentAccelerator = accelerator;
    return ok;
  } catch (err) {
    console.warn('[shortcut] register threw:', err.message);
    return false;
  }
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function createTrayIcon() {
  try {
    const p = path.join(__dirname, 'assets', 'icon.png');
    if (fs.existsSync(p)) return nativeImage.createFromPath(p).resize({ width: 16, height: 16 });
  } catch { /* ignore */ }
  try {
    return nativeImage.createFromBuffer(buildIconPng(32));
  } catch {
    return nativeImage.createFromBuffer(Buffer.alloc(16 * 16 * 4, 0), { width: 16, height: 16 });
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: `显示 / 隐藏 (${toDisplay(cfg.shortcut, process.platform)})`,
      click: () => toggleWindow(),
    },
    { type: 'separator' },
    {
      label: '窗口置顶',
      type: 'checkbox',
      checked: Boolean(cfg.alwaysOnTop),
      click: (item) => {
        cfg.alwaysOnTop = item.checked;
        if (win && !win.isDestroyed()) win.setAlwaysOnTop(item.checked, 'floating');
        saveConfig();
        broadcastConfig();
      },
    },
    {
      label: '屏幕共享隐身',
      type: 'checkbox',
      checked: Boolean(cfg.contentProtection),
      click: (item) => {
        cfg.contentProtection = item.checked;
        if (win && !win.isDestroyed()) win.setContentProtection(item.checked);
        saveConfig();
        broadcastConfig();
      },
    },
    { type: 'separator' },
    {
      label: '设置…',
      click: () => {
        if (win && !win.isDestroyed()) {
          win.show();
          win.focus();
          win.webContents.send('open-settings');
        }
      },
    },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip(APP_NAME);
  rebuildTrayMenu();
  tray.on('click', () => toggleWindow());
  tray.on('double-click', () => toggleWindow());
}

// ---------------------------------------------------------------------------
// File reading
// ---------------------------------------------------------------------------

const READABLE_EXT = new Set(['.md', '.markdown', '.mdown', '.mkd', '.txt']);

function readFileSafe(p) {
  try {
    const ext = path.extname(String(p)).toLowerCase();
    if (!READABLE_EXT.has(ext)) {
      return { error: '仅支持 .md / .markdown / .txt 文件' };
    }
    const raw = fs.readFileSync(p, 'utf8');
    return {
      path: p,
      name: path.basename(p),
      content: raw.replace(/^\uFEFF/, ''),
    };
  } catch (err) {
    return { error: err.message };
  }
}

function pushRecent(entry) {
  if (!entry || !entry.path) return;
  cfg.recents = [
    { path: entry.path, name: entry.name || path.basename(entry.path), ts: Date.now() },
    ...cfg.recents.filter((r) => r.path !== entry.path),
  ].slice(0, 10);
  cfg.lastFile = entry.path;
  saveConfig();
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

ipcMain.handle('get-config', () => configWithDisplay());

ipcMain.handle('update-config', (_e, patch) => {
  if (patch && typeof patch === 'object') {
    for (const key of ['fontSize', 'mode', 'opacity']) {
      if (key in patch) cfg[key] = patch[key];
    }
    saveConfig();
  }
  return configWithDisplay();
});

ipcMain.handle('set-shortcut', (_e, input) => {
  const v = normalizeAccelerator(input);
  if (!v.ok) return { ok: false, error: v.error };
  if (!applyShortcut(v.accelerator)) {
    // 注册失败：回滚并恢复旧快捷键，保证用户始终有可用的显隐键
    const old = normalizeAccelerator(cfg.shortcut);
    if (old.ok) applyShortcut(old.accelerator);
    return { ok: false, error: `注册失败：${toDisplay(v.accelerator, process.platform)} 可能已被其他应用占用（已保留原快捷键）` };
  }
  cfg.shortcut = v.accelerator;
  saveConfig();
  broadcastConfig();
  console.log('[shortcut] registered:', v.accelerator);
  return { ok: true, accelerator: v.accelerator, display: toDisplay(v.accelerator, process.platform) };
});

ipcMain.handle('toggle-visible', () => toggleWindow());
ipcMain.handle('hide-window', () => { if (win && !win.isDestroyed()) win.hide(); });

ipcMain.handle('set-opacity', (_e, v) => {
  cfg.opacity = clampOpacity(v);
  if (win && !win.isDestroyed()) win.setOpacity(cfg.opacity);
  saveConfig();
  return cfg.opacity;
});

ipcMain.handle('set-always-on-top', (_e, v) => {
  cfg.alwaysOnTop = Boolean(v);
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(cfg.alwaysOnTop, 'floating');
  saveConfig();
  return cfg.alwaysOnTop;
});

ipcMain.handle('set-content-protection', (_e, v) => {
  cfg.contentProtection = Boolean(v);
  if (win && !win.isDestroyed()) win.setContentProtection(cfg.contentProtection);
  saveConfig();
  return cfg.contentProtection;
});

ipcMain.handle('window-state', () => ({
  visible: win ? win.isVisible() : false,
  alwaysOnTop: Boolean(cfg.alwaysOnTop),
  contentProtection: Boolean(cfg.contentProtection),
  opacity: cfg.opacity,
}));

ipcMain.handle('open-file-dialog', async () => {
  if (!win || win.isDestroyed()) return { canceled: true };
  const r = await dialog.showOpenDialog(win, {
    title: '选择 Markdown 文件',
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const files = [];
  for (const p of r.filePaths) {
    const f = readFileSafe(p);
    if (f.error) {
      files.push({ error: f.error });
      continue;
    }
    pushRecent({ path: f.path, name: f.name });
    files.push(f);
  }
  broadcastConfig();
  return { canceled: false, files };
});

ipcMain.handle('read-file-by-path', (_e, p) => {
  const f = readFileSafe(p);
  if (!f.error) pushRecent({ path: f.path, name: f.name });
  return f;
});

ipcMain.handle('record-recent', (_e, entry) => {
  if (entry && typeof entry.path === 'string' && entry.path) {
    pushRecent({ path: entry.path, name: entry.name });
  }
  return cfg.recents;
});

ipcMain.handle('remove-recent', (_e, p) => {
  cfg.recents = cfg.recents.filter((r) => r.path !== p);
  if (cfg.lastFile === p) cfg.lastFile = null;
  saveConfig();
  return cfg.recents;
});

ipcMain.handle('get-recents', () => cfg.recents);

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    configFilePath = path.join(app.getPath('userData'), 'every-read-config.json');
    loadConfig();
    console.log('[every-read] starting, config at', configFilePath);
    console.log('[every-read] shortcut:', cfg.shortcut);

    createWindow();
    createTray();

    const v = normalizeAccelerator(cfg.shortcut);
    if (v.ok) {
      if (!applyShortcut(v.accelerator)) {
        console.warn('[shortcut] register failed (可能被占用):', v.accelerator);
      }
    } else {
      console.warn('[shortcut] stored shortcut invalid:', cfg.shortcut);
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('will-quit', () => {
    try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
  });
}
