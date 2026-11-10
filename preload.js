/**
 * every-read — preload：以受控白名单方式向渲染进程暴露 IPC 能力。
 */
'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('everyRead', {
  // 配置
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (patch) => ipcRenderer.invoke('update-config', patch),
  setShortcut: (input) => ipcRenderer.invoke('set-shortcut', input),

  // 文件
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  readFileByPath: (p) => ipcRenderer.invoke('read-file-by-path', p),
  recordRecent: (entry) => ipcRenderer.invoke('record-recent', entry),
  removeRecent: (p) => ipcRenderer.invoke('remove-recent', p),
  getRecents: () => ipcRenderer.invoke('get-recents'),

  // 窗口
  toggleVisible: () => ipcRenderer.invoke('toggle-visible'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  setOpacity: (v) => ipcRenderer.invoke('set-opacity', v),
  setAlwaysOnTop: (v) => ipcRenderer.invoke('set-always-on-top', v),
  setContentProtection: (v) => ipcRenderer.invoke('set-content-protection', v),
  windowState: () => ipcRenderer.invoke('window-state'),

  // 拖拽文件取真实路径（Electron >= 29 推荐 webUtils）
  pathForFile: (file) => webUtils.getPathForFile(file),

  // 主进程 → 渲染进程事件
  onConfigUpdated: (cb) => {
    const handler = (_e, c) => cb(c);
    ipcRenderer.on('config-updated', handler);
    return () => ipcRenderer.removeListener('config-updated', handler);
  },
  onOpenSettings: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('open-settings', handler);
    return () => ipcRenderer.removeListener('open-settings', handler);
  },
});
