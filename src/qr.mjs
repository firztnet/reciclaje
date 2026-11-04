// Generador de códigos QR (modo byte, versiones 1 a 10) sin dependencias, para el cartel de cada cliente.
// Sigue la norma ISO/IEC 18004: datos, corrección de errores Reed-Solomon, patrones fijos y la mejor máscara.

const ECL = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
// Códigos de corrección por bloque y número de bloques, por nivel (L, M, Q, H) y versión (1 a 10)
const ECC_PER_BLOCK = [
  [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
];
const NUM_BLOCKS = [
  [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
];
const MAX_VERSION = 10;

const rawModules = (ver) => {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
};
const dataCodewords = (ver, e) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];

// Aritmética en GF(256) con el polinomio 0x11D
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}
function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((d, i) => { result[i] ^= gfMul(d, factor); });
  }
  return result;
}

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const count = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 17 - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// Penalización de una máscara (reglas N1 a N4 de la norma)
function penalty(m) {
  const size = m.length;
  let score = 0;
  const lines = [];
  for (let i = 0; i < size; i++) {
    lines.push(m[i]);
    lines.push(m.map((row) => row[i]));
  }
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) { run++; continue; }
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
    }
    // N3: 1011101 con cuatro claros a un lado
    let bits = 0;
    for (let i = 0; i < size; i++) {
      bits = ((bits << 1) & 0x7ff) | (line[i] ? 1 : 0);
      if (i >= 10 && (bits === 0x5d0 || bits === 0x05d)) score += 40;
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
  }
  const dark = m.reduce((s, row) => s + row.filter(Boolean).length, 0);
  score += Math.abs(Math.ceil((dark * 100) / (size * size) / 5) - 10) * 10;
  return score;
}

/** Devuelve la matriz del QR (true = módulo oscuro) para un texto, con corrección de errores «ecl».
 *  «forceMask» (0-7) solo sirve para las pruebas; normalmente se elige la mejor máscara. */
export function qrMatrix(text, ecl = 'M', forceMask = undefined) {
  const e = ECL[ecl];
  const bytes = [...Buffer.from(String(text), 'utf8')];
  let ver = 1;
  for (; ver <= MAX_VERSION; ver++) {
    const countBits = ver <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(ver, e) * 8) break;
  }
  if (ver > MAX_VERSION) throw new Error('Texto demasiado largo para el QR');
  const capacity = dataCodewords(ver, e) * 8;

  // Datos: modo byte (0100), longitud, bytes, terminador y relleno
  const bits = [];
  const put = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Bloques con su corrección, intercalados
  const numBlocks = NUM_BLOCKS[e][ver];
  const eccLen = ECC_PER_BLOCK[e][ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= numShort) codewords.push(b[i]); });
  }

  // Patrones fijos
  const size = ver * 4 + 17;
  const base = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (m, x, y, dark) => { m[y][x] = dark; fixed[y][x] = true; };
  for (let i = 0; i < size; i++) { set(base, 6, i, i % 2 === 0); set(base, i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx; const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(base, x, y, d !== 2 && d !== 4); }
      }
    }
  }
  const pos = alignmentPositions(ver);
  pos.forEach((ay, i) => pos.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(base, ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const formatBits = (mask) => {
    const d = (FORMAT_BITS[ecl] << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((d << 10) | rem) ^ 0x5412;
  };
  const drawFormat = (m, mask) => {
    const b = formatBits(mask);
    const bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(m, 8, i, bit(i));
    set(m, 8, 7, bit(6)); set(m, 8, 8, bit(7)); set(m, 7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(m, 14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(m, size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(m, 8, size - 15 + i, bit(i));
    set(m, 8, size - 8, true);
  };
  drawFormat(base, 0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((b >>> i) & 1) === 1;
      const a = size - 11 + (i % 3); const c = Math.floor(i / 3);
      set(base, a, c, dark); set(base, c, a, dark);
    }
  }

  // Datos en zigzag
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fixed[y][x] && i < codewords.length * 8) {
          base[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }

  // La máscara con menos penalización
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = base.map((row, y) => row.map((dark, x) => (fixed[y][x] ? dark : dark !== MASKS[mask](x, y))));
    drawFormat(m, mask);
    const score = penalty(m);
    if (forceMask !== undefined && mask !== forceMask) continue;
    if (!best || score < best.score) best = { m, score, mask };
  }
  return { size, version: ver, mask: best.mask, modules: best.m };
}

/** QR en SVG (un solo trazado), con margen de 4 módulos alrededor. */
export function qrSvg(text, { ecl = 'M', label = 'Código QR' } = {}) {
  const { size, modules } = qrMatrix(text, ecl);
  const quiet = 4;
  let d = '';
  modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`; }));
  const full = size + quiet * 2;
  return `<svg class="qr-code" viewBox="0 0 ${full} ${full}" role="img" aria-label="${label.replace(/[&<>"]/g, '')}" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
