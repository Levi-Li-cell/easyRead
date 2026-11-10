/**
 * every-read — Markdown 块拆分（Node 与浏览器通用，UMD）。
 *
 * 用 markdown-it 的 token 流把文档切成"顶层块"，再按规则合并成虚拟列表条目：
 *  - 标题（heading）永远开启新条目 —— 便于分页断点和定位
 *  - 代码块（fence）独立成条目，前后断开
 *  - 其余小块按 minChars 合并，控制条目数量
 */
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EveryReadBlocks = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * 把 markdown-it 顶层 token 流按块分组。
   * 依赖 token.level（嵌套深度）与 token.nesting（1 开 / -1 闭 / 0 单）。
   */
  function groupTopLevelTokens(tokens) {
    const groups = [];
    let cur = null;
    for (const t of tokens) {
      if (t.level === 0 && t.nesting === 1) {
        cur = [t];
        groups.push(cur);
      } else if (t.level === 0 && t.nesting === -1) {
        if (cur) cur.push(t);
        else groups.push([t]);
        cur = null;
      } else if (t.level === 0 && t.nesting === 0) {
        cur = [t];
        groups.push(cur);
        cur = null;
      } else if (cur) {
        cur.push(t);
      } else {
        cur = [t];
        groups.push(cur);
      }
    }
    return groups.filter((g) => g && g.length);
  }

  function groupChars(group) {
    let n = 0;
    for (const t of group) {
      if (typeof t.content === 'string') n += t.content.length;
    }
    return n;
  }

  /**
   * @param {object} md markdown-it 实例
   * @param {string} src markdown 源文本
   * @param {{minChars?:number}} opts
   * @returns {Array<{html:string, chars:number, heading:string|null, fence:boolean}>}
   */
  function buildVirtualItems(md, src, opts = {}) {
    const minChars = Number.isFinite(opts.minChars) ? opts.minChars : 220;
    if (!src || !src.trim()) return [];

    const tokens = md.parse(src, {});
    const groups = groupTopLevelTokens(tokens);
    const blocks = groups.map((g) => ({
      html: md.renderer.render(g, md.options),
      chars: groupChars(g),
      heading: g[0].type === 'heading_open' ? (g[0].tag || 'h2') : null,
      fence: g[0].type === 'fence',
    }));

    const items = [];
    let cur = [];
    let curChars = 0;
    const flush = () => {
      if (!cur.length) return;
      items.push({
        html: cur.map((b) => b.html).join('\n'),
        chars: curChars,
        heading: cur[0].heading,
        fence: cur.length === 1 && cur[0].fence,
      });
      cur = [];
      curChars = 0;
    };

    for (const b of blocks) {
      // 标题：开启新条目并与后续内容保持同块（keep-with-next，避免分页时标题孤悬页尾）
      if (b.heading && cur.length) flush();
      // 代码块：前后断开，独立成条
      if (b.fence && cur.length) flush();
      cur.push(b);
      curChars += b.chars;
      if (b.fence || curChars >= minChars) flush();
    }
    flush();
    return items;
  }

  return { buildVirtualItems, groupTopLevelTokens };
});
