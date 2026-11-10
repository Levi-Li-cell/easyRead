/**
 * 生成 assets/icon.png 与 assets/icon.ico（纯 Node，无第三方依赖）。
 * 用法：node scripts/gen-icon.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { buildIconPng, buildIcoFromPng } = require('../lib/icon');

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

const png = buildIconPng(64);
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
console.log('[gen-icon] wrote assets/icon.png', png.length, 'bytes');

const ico = buildIcoFromPng(buildIconPng(256));
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
console.log('[gen-icon] wrote assets/icon.ico', ico.length, 'bytes');
