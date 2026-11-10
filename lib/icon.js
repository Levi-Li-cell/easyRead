/**
 * every-read — 纯 Node 生成 PNG 图标（无需任何第三方依赖）。
 * 用于托盘/窗口图标；同时被 scripts/gen-icon.js 复用。
 */
'use strict';

const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** rgba: Buffer，长度 width*height*4 */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 深色圆角底 + 打开的书本图形 */
function buildIconPng(size = 64) {
  const s = size;
  const rgba = Buffer.alloc(s * s * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= s || y >= s) return;
    const i = (y * s + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
  };

  const rad = Math.round(s * 0.22);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = x < rad ? rad - x : x >= s - rad ? x - (s - rad - 1) : 0;
      const dy = y < rad ? rad - y : y >= s - rad ? y - (s - rad - 1) : 0;
      const inCorner = dx > 0 && dy > 0;
      if (!inCorner || Math.sqrt(dx * dx + dy * dy) <= rad) {
        set(x, y, 15, 19, 23); // #0f1317
      }
    }
  }

  const cx = Math.floor(s / 2);
  const top = Math.round(s * 0.26);
  const bottom = Math.round(s * 0.74);
  const spineW = Math.max(1, Math.round(s * 0.05));
  const page = [226, 232, 240]; // #e2e8f0
  const line = [148, 163, 184]; // #94a3b8

  for (let y = top; y <= bottom; y++) {
    for (let x = spineW; x < cx - 1; x++) set(x, y, page[0], page[1], page[2]);
    for (let x = cx + 1; x < s - spineW; x++) set(x, y, page[0], page[1], page[2]);
    set(cx, y, 56, 189, 248); // 书脊高亮 #38bdf8
  }

  // 页面上的"文字行"
  const lineYs = [0.38, 0.48, 0.58];
  for (const fy of lineYs) {
    const y = Math.round(s * fy);
    for (let x = spineW + 2; x < cx - 3; x++) set(x, y, line[0], line[1], line[2]);
    for (let x = cx + 3; x < s - spineW - 2; x++) set(x, y, line[0], line[1], line[2]);
  }

  return encodePng(s, s, rgba);
}

/**
 * 将单张 PNG（建议 256x256）包装成 .ico 容器（Windows 支持 PNG 压缩的 256px 条目）。
 */
function buildIcoFromPng(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count

  const entry = Buffer.alloc(16);
  entry[0] = 0; // width: 0 = 256
  entry[1] = 0; // height: 0 = 256
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(pngBuffer.length, 8); // bytes in resource
  entry.writeUInt32LE(22, 12); // offset (6 + 16)

  return Buffer.concat([header, entry, pngBuffer]);
}

module.exports = { encodePng, buildIconPng, buildIcoFromPng };
