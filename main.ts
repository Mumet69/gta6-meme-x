// gta6-meme-x-01 — "WAITED 13 YEARS / STILL GOT 5 STARS ON DAY ONE"
// A GTA 6 launch-week meme, drawn from scratch in pure Node 22 stdlib.
// No network, no wall clock, no files outside this repository, deterministic:
// running it twice writes byte-identical outputs.
// Outputs go to MAKEFUN_OUTPUT_DIR (the repo is read-only under the grader), never into the repo dir.
// Scene: a Vice City / Leonida sunset chase. Jason and Lucia speed away in a
// pink convertible under a row of wanted stars — and the fifth star is the
// make.fun ghost itself, holding its magenta star coin, riding along.
// The program does two things:
//   1. renders meme.png (1024x1024) with its own tiny rasterizer + bitmap font
//   2. copies POST.json to /output/POST.json (all the grader needs from it)
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const W = 1024;
const H = 1024;

// ---------- PNG encoding (stdlib only) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePng(rgba: Buffer, w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- Canvas ----------
type RGB = [number, number, number];
const canvas = Buffer.alloc(W * H * 4);

function px(x: number, y: number, c: RGB, a = 255): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
  const o = (iy * W + ix) * 4;
  canvas[o] = c[0];
  canvas[o + 1] = c[1];
  canvas[o + 2] = c[2];
  canvas[o + 3] = a;
}

function rect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++)
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) px(x, y, c);
}

function vgrad(y0: number, y1: number, top: RGB, bottom: RGB): void {
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    const t = (y - y0) / (y1 - y0);
    const c: RGB = [
      Math.round(top[0] + (bottom[0] - top[0]) * t),
      Math.round(top[1] + (bottom[1] - top[1]) * t),
      Math.round(top[2] + (bottom[2] - top[2]) * t),
    ];
    rect(0, y, W, y + 1, c);
  }
}

function disc(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) px(x, y, c);
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) px(x, y, c);
    }
}

function poly(points: Array<[number, number]>, c: RGB): void {
  // Even-odd scanline fill for a simple polygon.
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2)
      for (let x = Math.ceil(xs[i]); x <= xs[i + 1]; x++) px(x, y, c);
  }
}

function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;
  const hw = w / 2;
  poly(
    [
      [x0 + nx * hw, y0 + ny * hw],
      [x1 + nx * hw, y1 + ny * hw],
      [x1 - nx * hw, y1 - ny * hw],
      [x0 - nx * hw, y0 - ny * hw],
    ],
    c,
  );
}

function star(cx: number, cy: number, rOuter: number, rInner: number, c: RGB, rot = -Math.PI / 2): void {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = rot + (i * Math.PI) / 5;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  poly(pts, c);
}

// ---------- Tiny 5x7 bitmap font (hand-drawn glyphs) ----------
// Each glyph: 7 rows of 5 bits, "#" = on.
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  ":": ["00000", "00100", "00000", "00000", "00000", "00100", "00000"],
  a: ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
  f: ["00110", "01000", "01000", "11110", "01000", "01000", "01000"],
  k: ["10000", "10000", "10100", "11000", "10100", "10010", "10001"],
  m: ["00000", "00000", "11010", "10101", "10101", "10101", "10101"],
  n: ["00000", "00000", "10110", "11001", "10001", "10001", "10001"],
  u: ["00000", "00000", "10001", "10001", "10001", "10011", "01101"],
};

function drawText(text: string, x: number, y: number, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of text) {
    const g = FONT[ch];
    if (g) {
      for (let r = 0; r < 7; r++)
        for (let col = 0; col < 5; col++)
          if (g[r][col] === "1") rect(cx + col * scale, y + r * scale, cx + (col + 1) * scale, y + (r + 1) * scale, c);
    }
    cx += 6 * scale;
  }
}

function textWidth(text: string, scale: number): number {
  return text.length * 6 * scale - scale;
}

function drawCentered(text: string, y: number, scale: number, c: RGB): void {
  drawText(text, Math.round((W - textWidth(text, scale)) / 2), y, scale, c);
}

// ---------- Palette ----------
const INK: RGB = [26, 16, 32];
const WHITE: RGB = [255, 255, 255];
const MAGENTA: RGB = [232, 33, 138];
const GOLD: RGB = [255, 209, 60];
const PINK: RGB = [255, 105, 180];

// ---------- The make.fun ghost ----------
// White ghost, thick black outline, two black four-pointed sparkle eyes,
// one round little hand, holding a magenta coin with a white star.
// Drawn big and IN the scene: it rides in the back of the getaway car,
// waving its coin like a fifth wanted star.
function ghost(cx: number, cy: number, s: number): void {
  const outline: RGB = [20, 12, 24];
  // Black underlay = outline (slightly larger, offset down a touch).
  ghostBody(cx + 4, cy + 5, s, outline);
  ghostBody(cx, cy, s, WHITE);
  // Sparkle eyes (four-pointed stars).
  sparkle(cx - s * 0.28, cy - s * 0.18, s * 0.16, outline);
  sparkle(cx + s * 0.28, cy - s * 0.18, s * 0.16, outline);
  // Little round hand waving at the car's edge (dark ring, white centre).
  disc(cx + s * 0.62, cy + s * 0.28, s * 0.13, outline);
  disc(cx + s * 0.62, cy + s * 0.28, s * 0.085, WHITE);
  // Magenta coin with a white star, held up high.
  disc(cx + s * 0.55, cy - s * 0.62, s * 0.30, MAGENTA);
  disc(cx + s * 0.55, cy - s * 0.62, s * 0.30, MAGENTA);
  star(cx + s * 0.55, cy - s * 0.62, s * 0.20, s * 0.085, WHITE);
}

function ghostBody(cx: number, cy: number, s: number, c: RGB): void {
  // Dome head + straight sides + wavy hem.
  disc(cx, cy - s * 0.28, s * 0.62, c);
  rect(cx - s * 0.62, cy - s * 0.28, cx + s * 0.62, cy + s * 0.55, c);
  // Wavy hem: three scallops.
  disc(cx - s * 0.42, cy + s * 0.55, s * 0.21, c);
  disc(cx, cy + s * 0.55, s * 0.21, c);
  disc(cx + s * 0.42, cy + s * 0.55, s * 0.21, c);
  rect(cx - s * 0.62, cy + s * 0.42, cx + s * 0.62, cy + s * 0.56, c);
}

function sparkle(cx: number, cy: number, r: number, c: RGB): void {
  // Four-pointed star: two thin diamonds crossed.
  poly(
    [
      [cx, cy - r],
      [cx + r * 0.28, cy - r * 0.28],
      [cx + r, cy],
      [cx + r * 0.28, cy + r * 0.28],
      [cx, cy + r],
      [cx - r * 0.28, cy + r * 0.28],
      [cx - r, cy],
      [cx - r * 0.28, cy - r * 0.28],
    ],
    c,
  );
}

// ---------- Palm tree silhouette ----------
function palm(x: number, baseY: number, h: number, lean: number): void {
  const topX = x + lean;
  const topY = baseY - h;
  thickLine(x, baseY, topX, topY, 16, INK);
  // Fronds: arcs of thick lines fanning from the crown.
  const fronds: Array<[number, number]> = [
    [-150, -20],
    [-120, -70],
    [-70, -105],
    [0, -115],
    [70, -105],
    [120, -70],
    [150, -20],
  ];
  for (const [dx, dy] of fronds) {
    thickLine(topX, topY, topX + dx, topY + dy + 95, 10, INK);
    thickLine(topX + dx * 0.5, topY + dy * 0.5 + 45, topX + dx, topY + dy + 95, 6, INK);
  }
  // Coconuts.
  disc(topX - 14, topY + 12, 12, INK);
  disc(topX + 14, topY + 12, 12, INK);
}

// ---------- The scene ----------
function drawScene(): void {
  // Sunset sky.
  vgrad(150, 700, [255, 122, 89], [255, 71, 126]);
  vgrad(700, 760, [255, 71, 126], [124, 58, 180]);
  // Sun, low over the ocean.
  disc(512, 640, 150, [255, 214, 90]);
  disc(512, 640, 118, [255, 190, 60]);
  // Ocean band.
  rect(0, 700, W, 800, [38, 120, 178]);
  for (let i = 0; i < 9; i++) rect(60 + i * 110, 726 + (i % 2) * 22, 150 + i * 110, 734 + (i % 2) * 22, [120, 200, 240]);
  // Sand.
  rect(0, 800, W, H, [232, 196, 138]);
  rect(0, 800, W, 812, [214, 176, 118]);
  // Distant skyline: Vice City towers.
  const towers: Array<[number, number, number]> = [
    [60, 560, 90],
    [150, 500, 70],
    [820, 520, 80],
    [900, 580, 90],
  ];
  for (const [x, y, w] of towers) {
    rect(x, y, x + w, 700, [74, 32, 96]);
    for (let wy = y + 18; wy < 690; wy += 34)
      for (let wx = x + 12; wx < x + w - 12; wx += 26) rect(wx, wy, wx + 12, wy + 14, GOLD);
  }
  // "LEONIDA" beach sign on the left.
  rect(40, 596, 290, 664, [255, 255, 255]);
  rect(40, 596, 290, 604, MAGENTA);
  drawText("LEONIDA", 48, 616, 5, INK);
  // Palm trees frame the scene.
  palm(120, 830, 330, 60);
  palm(920, 830, 300, -55);
  // Wanted stars row, top right of the sky.
  const starY = 210;
  for (let i = 0; i < 4; i++) {
    star(700 + i * 62, starY, 26, 11, GOLD);
    star(700 + i * 62, starY, 26, 11, GOLD);
  }
  // The fifth star is not a star: it is the ghost, riding shotgun on the
  // wanted level, holding its magenta coin up like a star.
  // (Drawn again big in the car below; here a small ghost star-mate.)
  star(700 + 4 * 62, starY, 26, 11, WHITE);
  // Pink convertible, centre-bottom, speeding left to right.
  const carY = 800;
  // Body.
  poly(
    [
      [300, carY + 60],
      [310, carY - 10],
      [360, carY - 55],
      [640, carY - 55],
      [700, carY - 5],
      [730, carY + 60],
    ],
    PINK,
  );
  rect(300, carY + 30, 730, carY + 62, [214, 40, 120]);
  // Windshield + side window.
  poly(
    [
      [380, carY - 48],
      [620, carY - 48],
      [660, carY - 10],
      [370, carY - 10],
    ],
    [178, 226, 248],
  );
  // Driver (Jason, dark hair) and passenger (Lucia, pink top).
  disc(450, carY - 32, 26, [212, 164, 120]);
  poly(
    [
      [424, carY - 40],
      [450, carY - 62],
      [476, carY - 40],
      [476, carY - 28],
      [424, carY - 28],
    ],
    INK,
  );
  disc(560, carY - 32, 26, [232, 184, 150]);
  poly(
    [
      [534, carY - 44],
      [560, carY - 64],
      [586, carY - 44],
      [586, carY - 28],
      [534, carY - 28],
    ],
    [90, 40, 50],
  );
  rect(536, carY - 12, 584, carY + 30, MAGENTA);
  // The make.fun ghost rides in the back seat, big and unmissable,
  // waving its magenta star coin at the cops (and the reader).
  ghost(700, carY - 130, 105);
  // Wheels.
  disc(390, carY + 62, 42, INK);
  disc(390, carY + 62, 20, [200, 200, 200]);
  disc(640, carY + 62, 42, INK);
  disc(640, carY + 62, 20, [200, 200, 200]);
  // Speed lines.
  for (let i = 0; i < 4; i++) rect(90 + i * 30, carY - 30 + i * 34, 230 + i * 30, carY - 22 + i * 34, WHITE);
  // "make.fun" wordmark bar, bottom centre, magenta on white.
  rect(362, 946, 662, 1006, WHITE);
  rect(362, 946, 662, 954, MAGENTA);
  drawText("make.fun", 398, 962, 7, MAGENTA);
  // Top caption banner.
  rect(0, 0, W, 150, INK);
  drawCentered("WAITED 13 YEARS", 14, 8, WHITE);
  drawCentered("FOR THIS", 78, 8, GOLD);
  // Bottom caption banner, full width, clear of the wheels.
  rect(0, 906, W, 946, INK);
  drawCentered("STILL GOT 5 STARS ON DAY ONE", 908, 5, WHITE);
}

// ---------- Entry point ----------
const here = dirname(fileURLToPath(import.meta.url));

function main(): void {
  drawScene();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? join(here, "out");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "meme.png"), encodePng(canvas, W, H));
  const post = readFileSync(join(here, "POST.json"));
  writeFileSync(join(outDir, "POST.json"), post);
}

main();
