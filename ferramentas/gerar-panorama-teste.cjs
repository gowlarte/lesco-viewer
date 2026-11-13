/**
 * Gera panoramas equirretangulares sintéticos para validar o renderer sem depender
 * de fotos reais. Útil quando se mexe no shader, na projeção ou no arrasto.
 *
 *   node ferramentas/gerar-panorama-teste.cjs
 *
 * Sobem pelo editor como qualquer outro arquivo. Se a barra vermelha não estiver
 * centrada em giro 0°, ou o horizonte não estiver reto, a projeção regrediu.
 *
 * Marcas de orientação, para conferir a convenção de ângulos na tela:
 *   u=0.50  barra VERMELHA   → giro 0°     (frente)
 *   u=0.25  barra VERDE      → giro +90°
 *   u=0.75  barra AZUL       → giro -90°
 *   u=0.00  barra AMARELA    → giro 180°   (costura)
 * Faixa de listras finas abaixo do horizonte: caso ruim de aliasing, como ripa de brise.
 */
const zlib = require('node:zlib');
const fs = require('node:fs');

const TABELA = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = TABELA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloco(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

function png(largura, altura, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;   // bits por canal
  ihdr[9] = 2;   // RGB
  const linhas = Buffer.alloc(altura * (largura * 3 + 1));
  for (let y = 0; y < altura; y += 1) {
    const de = y * largura * 3;
    const para = y * (largura * 3 + 1);
    linhas[para] = 0; // sem filtro
    rgb.copy(linhas, para + 1, de, de + largura * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', zlib.deflateSync(linhas, { level: 6 })),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

function gerar({ largura, altura, ceu, chao, nome }) {
  const rgb = Buffer.alloc(largura * altura * 3);
  const por = (x, y, r, g, b) => {
    const i = (y * largura + x) * 3;
    rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
  };

  const marcas = [
    { u: 0.5, cor: [198, 62, 48] },
    { u: 0.25, cor: [86, 148, 86] },
    { u: 0.75, cor: [70, 110, 158] },
    { u: 0.0, cor: [214, 176, 62] },
  ];
  const larguraMarca = Math.max(6, Math.round(largura * 0.006));

  for (let y = 0; y < altura; y += 1) {
    const v = y / (altura - 1);
    const acimaDoHorizonte = v < 0.5;
    // degradê vertical suave, mais claro no zênite
    const t = acimaDoHorizonte ? v / 0.5 : (v - 0.5) / 0.5;
    const base = acimaDoHorizonte
      ? ceu.map((c, i) => Math.round(c + (ceu[i] * 0.25) * (1 - t)))
      : chao.map((c) => Math.round(c * (1 - t * 0.35)));

    for (let x = 0; x < largura; x += 1) {
      let [r, g, b] = base;

      // grade de 15° em giro
      if (x % Math.round(largura / 24) === 0) { r -= 22; g -= 22; b -= 22; }
      // linha do horizonte
      if (Math.abs(v - 0.5) < 1.6 / altura) { r = 40; g = 40; b = 40; }
      // faixa de listras finas: 2 px on, 2 px off
      if (v > 0.55 && v < 0.66 && x % 4 < 2) { r = 232; g = 226; b = 214; }

      for (const m of marcas) {
        const cx = Math.round(m.u * largura);
        const d = Math.min(Math.abs(x - cx), Math.abs(x - cx - largura), Math.abs(x - cx + largura));
        if (d < larguraMarca) [r, g, b] = m.cor;
      }
      por(x, y, Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b)));
    }
  }
  fs.writeFileSync(nome, png(largura, altura, rgb));
  console.log(nome, `${largura}x${altura}`, `${(fs.statSync(nome).size / 1024 / 1024).toFixed(1)} MB`);
}

const L = 4096, A = 2048;
const SAIDA = process.argv[2] || process.cwd();
const em = (nome) => require('node:path').join(SAIDA, nome);

gerar({ largura: L, altura: A, ceu: [150, 168, 182], chao: [172, 142, 116], nome: em('pano-a.png') });
gerar({ largura: L, altura: A, ceu: [176, 168, 150], chao: [126, 132, 122], nome: em('pano-b.png') });
