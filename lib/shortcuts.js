/**
 * every-read — 快捷键解析与校验（纯逻辑，Node 与浏览器通用，UMD）。
 *
 * 设计参照 inter-assistant 的 desktop/shortcuts.js：
 *  - 组合键必须包含 CommandOrControl / Super / Alt 之一（Shift 单独使用无效）
 *  - F1-F24 可单独作为全局快捷键
 *  - 输入大小写不敏感；输出为规范化的 Electron accelerator
 */
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EveryReadShortcuts = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const F_KEY_RE = /^F(?:[1-9]|1[0-9]|2[0-4])$/;

  // 单键别名：把用户/键盘事件里的叫法统一成 Electron accelerator 名称
  const KEY_ALIASES = {
    ' ': 'Space',
    SPACE: 'Space',
    SPACEBAR: 'Space',
    PLUS: 'Plus',
    MINUS: 'Minus',
    ESC: 'Escape',
    ESCAPE: 'Escape',
    ARROWUP: 'Up',
    ARROWDOWN: 'Down',
    ARROWLEFT: 'Left',
    ARROWRIGHT: 'Right',
    UP: 'Up',
    DOWN: 'Down',
    LEFT: 'Left',
    RIGHT: 'Right',
    PGUP: 'PageUp',
    PGDN: 'PageDown',
    PAGEUP: 'PageUp',
    PAGEDOWN: 'PageDown',
    DEL: 'Delete',
    DELETE: 'Delete',
    INS: 'Insert',
    INSERT: 'Insert',
    ENTER: 'Enter',
    RETURN: 'Enter',
    TAB: 'Tab',
    BACKSPACE: 'Backspace',
    HOME: 'Home',
    END: 'End',
  };

  // 修饰键别名（Meta/Cmd/Win 全部归一到跨平台写法）
  const MODIFIER_MAP = {
    CTRL: 'CommandOrControl',
    CONTROL: 'CommandOrControl',
    CMD: 'CommandOrControl',
    COMMAND: 'CommandOrControl',
    META: 'CommandOrControl',
    COMMANDORCONTROL: 'CommandOrControl',
    SUPER: 'Super',
    WIN: 'Super',
    WINDOWS: 'Super',
    ALT: 'Alt',
    OPTION: 'Alt',
    OPT: 'Alt',
    SHIFT: 'Shift',
  };

  const SINGLE_KEYS = new Set([
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    ...'0123456789'.split(''),
    '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/', '`',
    'Space', 'Plus', 'Minus', 'Tab', 'Enter', 'Escape', 'Backspace',
    'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
    'Up', 'Down', 'Left', 'Right',
  ]);

  const MODIFIER_ORDER = ['CommandOrControl', 'Super', 'Alt', 'Shift'];

  function normalizeKey(raw) {
    if (typeof raw !== 'string' || !raw.length) return null;
    if (raw.length === 1) {
      if (KEY_ALIASES[raw]) return KEY_ALIASES[raw];
      return raw.toUpperCase();
    }
    const upper = raw.toUpperCase();
    if (KEY_ALIASES[upper]) return KEY_ALIASES[upper];
    if (F_KEY_RE.test(upper)) return upper;
    for (const cand of SINGLE_KEYS) {
      if (cand.toUpperCase() === upper) return cand;
    }
    return upper; // 未知键名，交由校验拒绝
  }

  /**
   * 解析并规范化快捷键字符串。
   * @param {string} input 形如 "Ctrl+Shift+Y" / "Cmd+P" / "F9" / "Alt+F4"
   * @returns {{ok:boolean, accelerator?:string, key?:string, error?:string}}
   */
  function normalizeAccelerator(input) {
    if (typeof input !== 'string' || !input.trim()) {
      return { ok: false, error: '快捷键为空' };
    }
    const parts = input.split('+').map((p) => p.trim()).filter((p) => p.length);
    if (!parts.length) {
      return { ok: false, error: '快捷键格式无效' };
    }
    const keyRaw = parts[parts.length - 1];
    const key = normalizeKey(keyRaw);
    if (!key || (!F_KEY_RE.test(key) && !SINGLE_KEYS.has(key))) {
      return { ok: false, error: `不支持的按键：${keyRaw}` };
    }

    const mods = new Set();
    for (const m of parts.slice(0, -1)) {
      const norm = MODIFIER_MAP[m.toUpperCase()];
      if (!norm) {
        return { ok: false, error: `不支持的修饰键：${m}` };
      }
      mods.add(norm);
    }

    const hasStrong = mods.has('CommandOrControl') || mods.has('Super') || mods.has('Alt');
    if (!hasStrong && !F_KEY_RE.test(key)) {
      return { ok: false, error: '必须包含 Ctrl/Cmd、Alt 或 Win 修饰键，或使用 F1-F24' };
    }

    const ordered = MODIFIER_ORDER.filter((m) => mods.has(m));
    return {
      ok: true,
      accelerator: [...ordered, key].join('+'),
      key,
    };
  }

  /** 转成面向用户的显示文本：CommandOrControl → Ctrl / Cmd */
  function toDisplay(accelerator, platform) {
    if (!accelerator) return '';
    const ctrlLabel = platform === 'darwin' ? 'Cmd' : 'Ctrl';
    const superLabel = platform === 'darwin' ? 'Super' : 'Win';
    return accelerator
      .split('+')
      .map((p) => {
        if (p === 'CommandOrControl') return ctrlLabel;
        if (p === 'Super') return superLabel;
        return p;
      })
      .join('+');
  }

  return { normalizeAccelerator, normalizeKey, toDisplay };
});
