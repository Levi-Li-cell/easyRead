'use strict';

const test = require('node:test');
const assert = require('node:assert');
const MarkdownIt = require('markdown-it');
const { buildVirtualItems, groupTopLevelTokens } = require('../lib/mdblocks');

const md = new MarkdownIt({ html: true, linkify: true });

test('buildVirtualItems: 空文本返回空数组', () => {
  assert.deepEqual(buildVirtualItems(md, ''), []);
  assert.deepEqual(buildVirtualItems(md, '   \n  '), []);
});

test('buildVirtualItems: minChars=0 时标题与段落各自成块', () => {
  const items = buildVirtualItems(md, '# A\n\ntext under a\n\n## B\n\nmore text\n', { minChars: 0 });
  assert.equal(items.length, 4);
  assert.equal(items[0].heading, 'h1');
  assert.equal(items[2].heading, 'h2');
  assert.ok(items[0].html.includes('<h1>'));
  assert.ok(items[2].html.includes('<h2>'));
});

test('buildVirtualItems: 默认 minChars 下标题与紧随短段合并', () => {
  const items = buildVirtualItems(md, '## T\n\nshort\n');
  assert.equal(items.length, 1);
  assert.equal(items[0].heading, 'h2');
  assert.ok(items[0].html.includes('<h2>'));
  assert.ok(items[0].html.includes('<p>short</p>'));
});

test('buildVirtualItems: 小段落按 minChars 合并', () => {
  const src = Array.from({ length: 20 }, (_, i) => `段落 ${i}`).join('\n\n');
  const merged = buildVirtualItems(md, src, { minChars: 220 });
  const split = buildVirtualItems(md, src, { minChars: 0 });
  assert.ok(merged.length < split.length);
  assert.equal(split.length, 20);
});

test('buildVirtualItems: 代码块独立成条且渲染为 pre', () => {
  const src = '前文一段。\n\n```js\nconst x = 1;\nconsole.log(x);\n```\n\n后文一段。';
  const items = buildVirtualItems(md, src, { minChars: 0 });
  const fence = items.find((it) => it.fence);
  assert.ok(fence, '存在独立代码条目');
  assert.ok(fence.html.includes('<pre><code'));
  assert.ok(fence.html.includes('console.log'));
});

test('buildVirtualItems: 表格渲染', () => {
  const src = '| a | b |\n| --- | --- |\n| 1 | 2 |';
  const items = buildVirtualItems(md, src, { minChars: 0 });
  assert.equal(items.length, 1);
  assert.ok(items[0].html.includes('<table>'));
});

test('buildVirtualItems: 原生 HTML 块透传', () => {
  const src = '<div class="x">hello</div>';
  const items = buildVirtualItems(md, src, { minChars: 0 });
  assert.equal(items.length, 1);
  assert.ok(items[0].html.includes('<div class="x">'));
});

test('buildVirtualItems: 标题合并首段，达到 minChars 后断开后续段落', () => {
  const src = '## 标题\n\n第一段：' + '很长的段落。'.repeat(40) + '\n\n第二段：' + '很长的段落。'.repeat(40);
  const items = buildVirtualItems(md, src, { minChars: 220 });
  assert.equal(items.length, 2);
  assert.equal(items[0].heading, 'h2');
  assert.ok(items[0].html.includes('<h2>'), '标题与首段同块（keep-with-next）');
  assert.ok(items[0].html.includes('第一段'));
  assert.ok(items[1].html.includes('第二段'), '后续段落独立成块');
});

test('groupTopLevelTokens: 嵌套结构完整分组', () => {
  const tokens = md.parse('> 引用里还有\n>\n> 两段文字\n\n后面的段落', {});
  const groups = groupTopLevelTokens(tokens);
  assert.equal(groups.length, 2);
  assert.equal(groups[0][0].type, 'blockquote_open');
  assert.equal(groups[1][0].type, 'paragraph_open');
});
