'use strict';

const test = require('node:test');
const assert = require('node:assert');
const S = require('../lib/shortcuts');

test('normalizeAccelerator: Ctrl 组合规范化为 CommandOrControl', () => {
  const v = S.normalizeAccelerator('Ctrl+Shift+Y');
  assert.equal(v.ok, true);
  assert.equal(v.accelerator, 'CommandOrControl+Shift+Y');
});

test('normalizeAccelerator: Cmd/Meta 同样归一为 CommandOrControl', () => {
  const v = S.normalizeAccelerator('Cmd+P');
  assert.equal(v.ok, true);
  assert.equal(v.accelerator, 'CommandOrControl+P');
});

test('normalizeAccelerator: CommandOrControl 原样保留', () => {
  const v = S.normalizeAccelerator('CommandOrControl+Y');
  assert.equal(v.ok, true);
  assert.equal(v.accelerator, 'CommandOrControl+Y');
});

test('normalizeAccelerator: F 键可单独使用', () => {
  for (const key of ['F1', 'F9', 'F24']) {
    const v = S.normalizeAccelerator(key);
    assert.equal(v.ok, true, key);
    assert.equal(v.accelerator, key);
  }
});

test('normalizeAccelerator: Alt+F4 合法', () => {
  const v = S.normalizeAccelerator('Alt+F4');
  assert.equal(v.ok, true);
  assert.equal(v.accelerator, 'Alt+F4');
});

test('normalizeAccelerator: 纯字母/数字被拒绝（避免全局劫持打字）', () => {
  assert.equal(S.normalizeAccelerator('Y').ok, false);
  assert.equal(S.normalizeAccelerator('5').ok, false);
});

test('normalizeAccelerator: 仅 Shift 修饰被拒绝', () => {
  assert.equal(S.normalizeAccelerator('Shift+A').ok, false);
});

test('normalizeAccelerator: 重复修饰键去重', () => {
  const v = S.normalizeAccelerator('Ctrl+Ctrl+Y');
  assert.equal(v.ok, true);
  assert.equal(v.accelerator, 'CommandOrControl+Y');
});

test('normalizeAccelerator: 空段 / 未知键 / 未知修饰被拒绝', () => {
  assert.equal(S.normalizeAccelerator('Ctrl+').ok, false);
  assert.equal(S.normalizeAccelerator('Ctrl+Foo').ok, false);
  assert.equal(S.normalizeAccelerator('Ctrl+FooKey+Y').ok, false);
  assert.equal(S.normalizeAccelerator('').ok, false);
  assert.equal(S.normalizeAccelerator(null).ok, false);
});

test('normalizeAccelerator: 空格与符号键映射', () => {
  const v1 = S.normalizeAccelerator('Ctrl+Space');
  assert.equal(v1.ok, true);
  assert.equal(v1.accelerator, 'CommandOrControl+Space');
  const v2 = S.normalizeAccelerator('Ctrl+/');
  assert.equal(v2.ok, true);
  assert.equal(v2.accelerator, 'CommandOrControl+/');
});

test('normalizeAccelerator: 方向键映射', () => {
  const v = S.normalizeAccelerator('Ctrl+ArrowDown');
  assert.equal(v.ok, true);
  assert.equal(v.accelerator, 'CommandOrControl+Down');
});

test('toDisplay: Windows 显示 Ctrl，macOS 显示 Cmd', () => {
  assert.equal(S.toDisplay('CommandOrControl+Shift+Y', 'win32'), 'Ctrl+Shift+Y');
  assert.equal(S.toDisplay('CommandOrControl+Shift+Y', 'darwin'), 'Cmd+Shift+Y');
  assert.equal(S.toDisplay('Alt+F4', 'win32'), 'Alt+F4');
  assert.equal(S.toDisplay('CommandOrControl+Shift+Y', 'linux'), 'Ctrl+Shift+Y');
});
