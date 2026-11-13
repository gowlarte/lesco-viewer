/**
 * Verificacao do codificador de QR — ferramentas/qr.js
 *
 *   node ferramentas/qr-verifica.js
 *
 * QR errado se descobre com a camera na mao, o que e tarde. Dois testes independentes:
 *
 *  1. SINDROMES. Uma palavra-codigo Reed-Solomon valida avaliada em alfa^1..alfa^n da
 *     zero em todas. Isso prova o polinomio gerador e a divisao, sem depender de vetor
 *     de teste decorado.
 *
 *  2. VOLTA. Le a matriz final como um leitor leria — formato, mascara, ziguezague,
 *     desintercalacao, modo byte — e compara com o texto original. O caminho de leitura
 *     e reescrito aqui de proposito, nao importado, para pegar erro de transcricao.
 */

// O codificador mora em app/js/ desde que passou a ser usado pelo editor. Este
// verificador continua em ferramentas/ porque e ferramenta, e nao vai no pacote.
import { qr, correcao } from '../app/js/qr.js';

const TOTAL = [null, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const BLOCOS = [
  null,
  { ecc: 10, grupos: [[1, 16]] }, { ecc: 16, grupos: [[1, 28]] },
  { ecc: 26, grupos: [[1, 44]] }, { ecc: 18, grupos: [[2, 32]] },
  { ecc: 24, grupos: [[2, 43]] }, { ecc: 16, grupos: [[4, 27]] },
  { ecc: 18, grupos: [[4, 31]] }, { ecc: 22, grupos: [[2, 38], [2, 39]] },
  { ecc: 22, grupos: [[3, 36], [2, 37]] }, { ecc: 26, grupos: [[4, 43], [1, 44]] },
];
const ALINHAMENTO = [
  null, [], [6, 18], [6, 22], [6, 26], [6, 30],
  [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

// ── teste 1: sindromes ──────────────────────────────────────────────────────

/**
 * Todas as sindromes de uma palavra-codigo valida sao zero.
 *
 * As raizes sao alfa^0 .. alfa^(n-1), e nao alfa^1 .. alfa^n: e a convencao do
 * ISO-18004, e e a que gerador() usa em qr.js. Avaliar em alfa^n acusaria falha em
 * toda versao — sempre e so na ultima sindrome, que e o sintoma deste engano.
 */
function sindromesZeradas(dados, nEcc) {
  const ecc = correcao(dados, nEcc);
  const c = [...dados, ...ecc];
  for (let k = 0; k < nEcc; k++) {
    let s = 0;
    for (let i = 0; i < c.length; i++) {
      // c[i] * (alfa^k)^(grau), com grau = len-1-i
      s ^= mul(c[i], EXP[((k * (c.length - 1 - i)) % 255)]);
    }
    if (s !== 0) return { ok: false, k, s };
  }
  return { ok: true };
}

// ── teste 2: leitura de volta ───────────────────────────────────────────────

const MASCARAS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

/** Mapa dos modulos de servico, redesenhado a partir da especificacao. */
function mapaFixo(n, v) {
  const f = Array.from({ length: n }, () => new Array(n).fill(false));
  const marca = (y, x) => { if (y >= 0 && y < n && x >= 0 && x < n) f[y][x] = true; };

  for (const [ly, lx] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) marca(ly + y, lx + x);
  }
  for (let i = 0; i < n; i++) { marca(6, i); marca(i, 6); }

  const centros = ALINHAMENTO[v];
  for (const cy of centros) {
    for (const cx of centros) {
      const noLocalizador =
        (cy <= 8 && cx <= 8) || (cy <= 8 && cx >= n - 9) || (cy >= n - 9 && cx <= 8);
      if (noLocalizador) continue;
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) marca(cy + y, cx + x);
    }
  }

  for (let i = 0; i < 9; i++) { marca(8, i); marca(i, 8); }
  for (let i = 0; i < 8; i++) { marca(8, n - 1 - i); marca(n - 1 - i, 8); }
  if (v >= 7) {
    for (let i = 0; i < 18; i++) {
      marca(n - 11 + (i % 3), Math.floor(i / 3));
      marca(Math.floor(i / 3), n - 11 + (i % 3));
    }
  }
  return f;
}

function ler(matriz) {
  const m = matriz.map((l) => l.map((b) => (b ? 1 : 0)));
  const n = m.length;
  const v = (n - 17) / 4;
  if (!Number.isInteger(v) || v < 1 || v > 10) throw new Error(`lado invalido: ${n}`);

  // formato, copia 1
  let fmt = 0;
  for (let i = 0; i < 15; i++) {
    let bit;
    if (i < 6) bit = m[8][i];
    else if (i === 6) bit = m[8][7];
    else if (i === 7) bit = m[8][8];
    else if (i === 8) bit = m[7][8];
    else bit = m[14 - i][8];
    fmt |= bit << i;
  }
  fmt ^= 0x5412;
  // A palavra de formato e (dados << 10) | bch, com dados = (nivel << 3) | mascara.
  // Os cinco bits de dados moram no ALTO, nos bits 14..10 — nao nos cinco de baixo,
  // que sao o resto do BCH. Ler dali devolve mascara errada, a matriz e desmascarada
  // com a mascara errada, e todo o resto da leitura vira ruido.
  const mascara = (fmt >> 10) & 0b111;
  const nivel = (fmt >> 13) & 0b11;

  const fixo = mapaFixo(n, v);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) if (!fixo[i][j] && MASCARAS[mascara](i, j)) m[i][j] ^= 1;
  }

  const bits = [];
  let coluna = n - 1;
  let subindo = true;
  while (coluna > 0) {
    if (coluna === 6) coluna = 5;
    for (let k = 0; k < n; k++) {
      const linha = subindo ? n - 1 - k : k;
      for (const c of [coluna, coluna - 1]) if (!fixo[linha][c]) bits.push(m[linha][c]);
    }
    coluna -= 2;
    subindo = !subindo;
  }

  const cw = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    cw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }

  const { ecc: nEcc, grupos } = BLOCOS[v];
  const tamanhos = [];
  for (const [qtd, tam] of grupos) for (let i = 0; i < qtd; i++) tamanhos.push(tam);

  const blocos = tamanhos.map((t) => new Array(t));
  let idx = 0;
  const maior = Math.max(...tamanhos);
  for (let i = 0; i < maior; i++) {
    for (let b = 0; b < blocos.length; b++) if (i < tamanhos[b]) blocos[b][i] = cw[idx++];
  }
  const eccLidos = blocos.map(() => []);
  for (let i = 0; i < nEcc; i++) for (let b = 0; b < blocos.length; b++) eccLidos[b].push(cw[idx++]);

  const dados = blocos.flat();
  const modo = (dados[0] >> 4) & 0b1111;
  if (modo !== 0b0100) throw new Error(`modo lido ${modo.toString(2)}, esperado 100`);

  // contagem e bytes vivem desalinhados do byte: 4 bits de modo na frente
  const fluxo = [];
  for (const b of dados) for (let i = 7; i >= 0; i--) fluxo.push((b >> i) & 1);
  let p = 4;
  const nb = v <= 9 ? 8 : 16;
  let contagem = 0;
  for (let i = 0; i < nb; i++) contagem = (contagem << 1) | fluxo[p++];

  const saida = [];
  for (let i = 0; i < contagem; i++) {
    let byte = 0;
    for (let k = 0; k < 8; k++) byte = (byte << 1) | fluxo[p++];
    saida.push(byte);
  }

  return {
    texto: Buffer.from(saida).toString('utf8'),
    versao: v,
    mascara,
    nivel,
    blocos: blocos.length,
    eccIntegro: blocos.every((d, i) => {
      const calc = correcao(Uint8Array.from(d), nEcc);
      return calc.every((x, k) => x === eccLidos[i][k]);
    }),
  };
}

// ── execucao ────────────────────────────────────────────────────────────────

const CASOS = [
  'http://172.16.0.22:4360/',
  'http://172.16.0.22:4360/gestao',
  'http://172.16.0.22:4360/tour?t=teste',
  'http://172.16.0.22:4360/gestao/tour?t=teste',
  'http://localhost:4360/',
  'A',
  'http://172.16.0.22:4360/tour?t=' + 'a'.repeat(60),
];

/** Passa da versao 10 e tem que ser recusado com mensagem, nao gerar QR ilegivel. */
const CASO_LONGO = 'http://172.16.0.22:4360/tour?t=' + 'b'.repeat(200);

let falhas = 0;

console.log('\n1. SINDROMES DE REED-SOLOMON');
for (let v = 1; v <= 10; v++) {
  const { ecc, grupos } = BLOCOS[v];
  const tam = grupos[0][1];
  const dados = Uint8Array.from({ length: tam }, (_, i) => (i * 37 + v * 11) & 0xff);
  const r = sindromesZeradas(dados, ecc);
  if (!r.ok) {
    console.log(`   v${v} nivel M: FALHOU — sindrome S${r.k} = ${r.s}`);
    falhas++;
  }
}
if (!falhas) console.log('   v1..v10 nivel M: todas as sindromes zeradas');

console.log('\n2. LEITURA DE VOLTA');
for (const texto of CASOS) {
  try {
    const { matriz, versao, mascara } = qr(texto);
    const lido = ler(matriz);
    const igual = lido.texto === texto;
    const rotulo = texto.length > 46 ? `${texto.slice(0, 43)}...` : texto;
    if (!igual || !lido.eccIntegro || lido.versao !== versao || lido.mascara !== mascara) {
      falhas++;
      console.log(`   FALHOU  ${rotulo}`);
      console.log(`           texto igual: ${igual} | ecc integro: ${lido.eccIntegro}`);
      if (!igual) console.log(`           lido: ${lido.texto}`);
    } else {
      console.log(
        `   ok  v${versao} ${17 + 4 * versao}x${17 + 4 * versao} mascara ${mascara} `
        + `nivel ${['M', 'L', 'H', 'Q'][lido.nivel]} ${lido.blocos} bloco(s)  ${rotulo}`,
      );
    }
  } catch (e) {
    falhas++;
    console.log(`   ERRO  ${texto.slice(0, 60)}\n         ${e.message}`);
  }
}

console.log('\n3. LIMITE DE CAPACIDADE');
try {
  qr(CASO_LONGO);
  falhas++;
  console.log('   FALHOU  aceitou texto acima da versao 10 em vez de recusar');
} catch (e) {
  console.log(`   ok  recusado com motivo: ${e.message}`);
}

console.log(falhas ? `\n${falhas} falha(s)\n` : '\nTudo verificado.\n');
process.exit(falhas ? 1 : 0);
