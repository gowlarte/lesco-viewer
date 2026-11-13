/**
 * Codificador de QR Code — modo byte, correcao nivel M, versoes 1 a 10.
 *
 * Existe porque o projeto nao tem npm install e um QR de servico externo exigiria rede
 * e mandaria a URL para fora. Cobre de sobra o que se precisa aqui: v10 leva 271 bytes
 * e a URL mais longa do editor tem 43 caracteres.
 *
 * Nivel M corrige 15% do simbolo. Em tela isso e folga confortavel; foi escolhido em vez
 * do nivel L porque a diferenca de tamanho e irrelevante nessas versoes baixas.
 *
 * Referencia: ISO/IEC 18004. Verificacao em ferramentas/qr-verifica.js — sindromes de
 * Reed-Solomon zeradas e decodificacao de volta ate o texto original.
 */

// ── aritmetica em GF(256), polinomio primitivo 0x11D ────────────────────────

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Polinomio gerador para n codewords de correcao: produto de (x + alfa^i). */
function gerador(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const r = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      r[j] ^= g[j];
      r[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = r;
  }
  return g;
}

/** Resto da divisao polinomial — os codewords de correcao do bloco. */
export function correcao(dados, n) {
  const g = gerador(n);
  const buf = new Uint8Array(dados.length + n);
  buf.set(dados);
  for (let i = 0; i < dados.length; i++) {
    const c = buf[i];
    if (!c) continue;
    // g e monico, entao g[0] === 1 e este passo zera buf[i].
    for (let j = 0; j < g.length; j++) buf[i + j] ^= mul(g[j], c);
  }
  return buf.slice(dados.length);
}

// ── tabelas por versao ──────────────────────────────────────────────────────

/** Total de codewords do simbolo, independente do nivel de correcao. */
const TOTAL = [null, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

/** Nivel M: correcao por bloco e composicao dos grupos [qtdBlocos, dadosPorBloco]. */
const BLOCOS = [
  null,
  { ecc: 10, grupos: [[1, 16]] },
  { ecc: 16, grupos: [[1, 28]] },
  { ecc: 26, grupos: [[1, 44]] },
  { ecc: 18, grupos: [[2, 32]] },
  { ecc: 24, grupos: [[2, 43]] },
  { ecc: 16, grupos: [[4, 27]] },
  { ecc: 18, grupos: [[4, 31]] },
  { ecc: 22, grupos: [[2, 38], [2, 39]] },
  { ecc: 22, grupos: [[3, 36], [2, 37]] },
  { ecc: 26, grupos: [[4, 43], [1, 44]] },
];

/** Centros dos padroes de alinhamento. */
const ALINHAMENTO = [
  null, [], [6, 18], [6, 22], [6, 26], [6, 30],
  [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

/**
 * As duas tabelas acima vem de fontes diferentes da especificacao e precisam fechar
 * entre si. Uma linha errada geraria um QR que nenhuma camera le, e o erro apareceria
 * como "nao funciona" sem pista nenhuma. Aqui ele aparece na carga do modulo.
 */
for (let v = 1; v <= 10; v++) {
  const { ecc, grupos } = BLOCOS[v];
  const soma = grupos.reduce((s, [q, d]) => s + q * (d + ecc), 0);
  if (soma !== TOTAL[v]) {
    throw new Error(`tabela QR inconsistente na versao ${v}: ${soma} != ${TOTAL[v]}`);
  }
}

const capacidade = (v) => BLOCOS[v].grupos.reduce((s, [q, d]) => s + q * d, 0);
const bitsContagem = (v) => (v <= 9 ? 8 : 16);
const lado = (v) => 17 + 4 * v;

// ── informacao de formato e de versao ───────────────────────────────────────

/** BCH(15,5) do formato, com a mascara fixa 0x5412 aplicada por cima. */
function infoFormato(mascara) {
  const dados = (0b00 << 3) | mascara; // 0b00 = nivel M
  let r = dados << 10;
  for (let i = 14; i >= 10; i--) if ((r >> i) & 1) r ^= 0x537 << (i - 10);
  return ((dados << 10) | r) ^ 0x5412;
}

/** BCH(18,6) da versao — presente somente a partir da versao 7. */
function infoVersao(v) {
  let r = v << 12;
  for (let i = 17; i >= 12; i--) if ((r >> i) & 1) r ^= 0x1f25 << (i - 12);
  return (v << 12) | r;
}

// ── montagem do fluxo de bits ───────────────────────────────────────────────

function versaoPara(nBytes) {
  for (let v = 1; v <= 10; v++) {
    // 4 bits de modo + contagem + dados, tudo em bits
    if (4 + bitsContagem(v) + nBytes * 8 <= capacidade(v) * 8) return v;
  }
  throw new Error(`texto longo demais para QR versao 10: ${nBytes} bytes`);
}

function fluxoDeBits(bytes, v) {
  const bits = [];
  const push = (valor, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((valor >> i) & 1);
  };

  push(0b0100, 4); // modo byte
  push(bytes.length, bitsContagem(v));
  for (const b of bytes) push(b, 8);

  const limite = capacidade(v) * 8;
  // Terminador de até 4 bits, depois alinhamento ao byte.
  for (let i = 0; i < 4 && bits.length < limite; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }
  // Preenchimento alternado prescrito pela especificacao.
  const enchimento = [0xec, 0x11];
  for (let i = 0; codewords.length < capacidade(v); i++) codewords.push(enchimento[i % 2]);

  return Uint8Array.from(codewords);
}

/** Divide em blocos, calcula correcao e intercala na ordem que o leitor espera. */
function codewordsFinais(dados, v) {
  const { ecc, grupos } = BLOCOS[v];
  const blocos = [];
  let p = 0;
  for (const [qtd, tam] of grupos) {
    for (let i = 0; i < qtd; i++) {
      const d = dados.slice(p, p + tam);
      p += tam;
      blocos.push({ dados: d, ecc: correcao(d, ecc) });
    }
  }

  const saida = [];
  const maiorDados = Math.max(...blocos.map((b) => b.dados.length));
  for (let i = 0; i < maiorDados; i++) {
    for (const b of blocos) if (i < b.dados.length) saida.push(b.dados[i]);
  }
  for (let i = 0; i < ecc; i++) {
    for (const b of blocos) saida.push(b.ecc[i]);
  }
  return { codewords: Uint8Array.from(saida), blocos };
}

// ── matriz ──────────────────────────────────────────────────────────────────

function matrizBase(v) {
  const n = lado(v);
  const m = Array.from({ length: n }, () => new Array(n).fill(0));
  const fixo = Array.from({ length: n }, () => new Array(n).fill(false));
  const por = (linha, coluna, valor) => {
    m[linha][coluna] = valor;
    fixo[linha][coluna] = true;
  };

  // Tres localizadores 7x7 com separador de um modulo claro.
  for (const [ly, lx] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const py = ly + y;
        const px = lx + x;
        if (py < 0 || py >= n || px < 0 || px >= n) continue;
        const borda = y === 0 || y === 6 || x === 0 || x === 6;
        const centro = y >= 2 && y <= 4 && x >= 2 && x <= 4;
        const dentro = y >= 0 && y <= 6 && x >= 0 && x <= 6;
        por(py, px, dentro && (borda || centro) ? 1 : 0);
      }
    }
  }

  // Padroes de tempo na linha e coluna 6.
  for (let i = 8; i < n - 8; i++) {
    const valor = i % 2 === 0 ? 1 : 0;
    por(6, i, valor);
    por(i, 6, valor);
  }

  // Alinhamento 5x5, exceto onde colidiria com um localizador.
  const centros = ALINHAMENTO[v];
  for (const cy of centros) {
    for (const cx of centros) {
      const noLocalizador =
        (cy <= 8 && cx <= 8) || (cy <= 8 && cx >= n - 9) || (cy >= n - 9 && cx <= 8);
      if (noLocalizador) continue;
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          const borda = Math.abs(y) === 2 || Math.abs(x) === 2;
          por(cy + y, cx + x, borda || (y === 0 && x === 0) ? 1 : 0);
        }
      }
    }
  }

  // Modulo escuro fixo, e reserva das areas de formato.
  por(n - 8, 8, 1);
  for (let i = 0; i < 9; i++) {
    if (!fixo[8][i]) por(8, i, 0);
    if (!fixo[i][8]) por(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (!fixo[8][n - 1 - i]) por(8, n - 1 - i, 0);
    if (!fixo[n - 1 - i][8]) por(n - 1 - i, 8, 0);
  }

  // Informacao de versao, a partir da versao 7.
  if (v >= 7) {
    const info = infoVersao(v);
    for (let i = 0; i < 18; i++) {
      const bit = (info >> i) & 1;
      por(n - 11 + (i % 3), Math.floor(i / 3), bit);
      por(Math.floor(i / 3), n - 11 + (i % 3), bit);
    }
  }

  return { m, fixo, n };
}

/** Percurso em ziguezague a partir do canto inferior direito, aos pares de coluna. */
function preencher(m, fixo, n, codewords) {
  let bit = 0;
  const proximo = () => {
    const total = codewords.length * 8;
    if (bit >= total) return 0; // bits de resto, sempre claros
    const valor = (codewords[bit >> 3] >> (7 - (bit % 8))) & 1;
    bit++;
    return valor;
  };

  let coluna = n - 1;
  let subindo = true;
  while (coluna > 0) {
    if (coluna === 6) coluna = 5; // a coluna de tempo nao carrega dado
    for (let k = 0; k < n; k++) {
      const linha = subindo ? n - 1 - k : k;
      for (const c of [coluna, coluna - 1]) {
        if (!fixo[linha][c]) m[linha][c] = proximo();
      }
    }
    coluna -= 2;
    subindo = !subindo;
  }
}

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

/** As quatro penalidades da especificacao; ganha a mascara de menor soma. */
function penalidade(m, n) {
  let p = 0;

  const corrida = (get) => {
    for (let a = 0; a < n; a++) {
      let cor = -1;
      let len = 0;
      for (let b = 0; b < n; b++) {
        const v = get(a, b);
        if (v === cor) {
          len++;
        } else {
          if (len >= 5) p += 3 + (len - 5);
          cor = v;
          len = 1;
        }
      }
      if (len >= 5) p += 3 + (len - 5);
    }
  };
  corrida((a, b) => m[a][b]);
  corrida((a, b) => m[b][a]);

  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const v = m[i][j];
      if (v === m[i][j + 1] && v === m[i + 1][j] && v === m[i + 1][j + 1]) p += 3;
    }
  }

  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const casa = (get, a, b, alvo) => alvo.every((x, k) => get(a, b + k) === x);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b + 10 < n; b++) {
      if (casa((y, x) => m[y][x], a, b, A) || casa((y, x) => m[y][x], a, b, B)) p += 40;
      if (casa((y, x) => m[x][y], a, b, A) || casa((y, x) => m[x][y], a, b, B)) p += 40;
    }
  }

  let escuros = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) escuros += m[i][j];
  const pct = (escuros * 100) / (n * n);
  p += 10 * Math.floor(Math.abs(pct - 50) / 5);

  return p;
}

/**
 * Devolve { matriz, versao, mascara, lado } com a matriz booleana final —
 * true = modulo escuro. Sem zona de silencio: quem desenha adiciona.
 */
export function qr(texto) {
  // TextEncoder e nao Buffer: este modulo passou a rodar tambem no navegador, onde
  // Buffer nao existe. Os dois dao o mesmo UTF-8.
  const bytes = new TextEncoder().encode(texto);
  const v = versaoPara(bytes.length);
  const { codewords } = codewordsFinais(fluxoDeBits(bytes, v), v);

  let melhor = null;
  for (let mascara = 0; mascara < 8; mascara++) {
    const { m, fixo, n } = matrizBase(v);
    preencher(m, fixo, n, codewords);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (!fixo[i][j] && MASCARAS[mascara](i, j)) m[i][j] ^= 1;
      }
    }
    // O formato entra depois da mascara e nao e mascarado.
    const info = infoFormato(mascara);
    for (let i = 0; i < 15; i++) {
      const bit = (info >> i) & 1;
      if (i < 6) m[8][i] = bit;
      else if (i === 6) m[8][7] = bit;
      else if (i === 7) m[8][8] = bit;
      else if (i === 8) m[7][8] = bit;
      else m[14 - i][8] = bit;

      if (i < 7) m[n - 1 - i][8] = bit;
      else m[8][n - 15 + i] = bit;
    }

    const p = penalidade(m, n);
    if (!melhor || p < melhor.p) melhor = { p, m, n, mascara };
  }

  return {
    matriz: melhor.m.map((linha) => linha.map(Boolean)),
    lado: melhor.n,
    versao: v,
    mascara: melhor.mascara,
  };
}

/** SVG autossuficiente, com a zona de silencio de 4 modulos que a norma exige. */
export function qrSvg(texto, { modulo = 4, silencio = 4, classe = '' } = {}) {
  const { matriz, lado: n } = qr(texto);
  const total = (n + silencio * 2) * modulo;

  let d = '';
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (!matriz[i][j]) continue;
      const x = (j + silencio) * modulo;
      const y = (i + silencio) * modulo;
      d += `M${x} ${y}h${modulo}v${modulo}h-${modulo}z`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" `
    + `width="${total}" height="${total}" class="${classe}" shape-rendering="crispEdges" `
    + `role="img" aria-label="QR code para ${texto}">`
    + `<rect width="${total}" height="${total}" fill="#fff"/>`
    + `<path d="${d}" fill="#1E1E1E"/></svg>`;
}
