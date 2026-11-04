import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, test } from 'node:test';
import { qrMatrix, qrSvg } from '../src/qr.mjs';

// Huellas de referencia sacadas de la librería «qrcode» (modo byte, nivel M) para los mismos textos:
// si el generador cambia un solo módulo, la huella deja de coincidir.
const GOLDEN = [
  { t: 'https://elchatarrerodemadrid.reciclar.firztnet.es/', version: 4, mask: 2, sha: '15619912a4077ed655b694e8d98717aa7fb1de45fdba87b97ad88af0ae6e0816' },
  { t: 'https://wa.me/34603582259', version: 2, mask: 2, sha: 'ed70f6775d7a89f329dba5ca0958359db9dd8a7a435293a1a931e44f9dc81e81' },
];
const fingerprint = (modules) => crypto.createHash('sha256').update(modules.map((row) => row.map((d) => (d ? '1' : '0')).join('')).join('')).digest('hex');

describe('código QR', () => {
  for (const g of GOLDEN) {
    test(`coincide con la referencia: ${g.t}`, () => {
      const q = qrMatrix(g.t, 'M');
      assert.equal(q.version, g.version);
      assert.equal(q.mask, g.mask);
      assert.equal(fingerprint(q.modules), g.sha);
    });
  }
  test('en SVG lleva margen blanco y no admite textos enormes', () => {
    const svg = qrSvg('https://x.es/');
    assert.match(svg, /^<svg class="qr-code" viewBox="0 0 29 29"/);
    assert.throws(() => qrMatrix('x'.repeat(500)), /demasiado largo/);
  });
});
