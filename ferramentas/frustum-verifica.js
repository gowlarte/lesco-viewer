/**
 * Verificacao do sinal do frustum assimetrico usado por raioDeVista, em panorama.js.
 *
 *   node ferramentas/frustum-verifica.js
 *
 * Por que isto existe: o deslocamento do centro optico entra somando, e com o sinal
 * trocado NADA acontece em tela plana — ali o frustum e simetrico e P02 = 0. O erro so
 * nasce dentro do headset, onde cada olho tem P02 de sinal oposto, e a consequencia e a
 * imagem nao fundir. Custou um teste em aparelho para descobrir; este arquivo faz a
 * mesma pergunta em um segundo.
 *
 * A verdade e conhecida por construcao: no plano z = -1 o frustum vai de l a r e de b a
 * t, entao o canto (-1,-1) do NDC tem de cair exatamente em (l, b, -1).
 */

/** Projecao perspectiva descentrada, column-major, como o WebXR entrega por olho. */
function projecao(l, r, b, t, n, f) {
  const P = new Array(16).fill(0);
  P[0] = (2 * n) / (r - l);
  P[5] = (2 * n) / (t - b);
  P[8] = (r + l) / (r - l);
  P[9] = (t + b) / (t - b);
  P[10] = -(f + n) / (f - n);
  P[11] = -1;
  P[14] = (-2 * f * n) / (f - n);
  return P;
}

/** A mesma aritmetica de raioDeVista, com rotacao identidade e sem giro de mundo. */
function raio(P, sinal) {
  const [p00, p11, p02, p12] = [P[0], P[5], P[8], P[9]];
  const ox = (sinal * p02) / p00;
  const oy = (sinal * p12) / p11;
  return (x, y) => [x / p00 + ox, y / p11 + oy, -1];
}

const CASOS = [
  { nome: 'simetrico (tela plana)', l: -1, r: 1, b: -0.8, t: 0.8 },
  { nome: 'olho esquerdo          ', l: -1.2, r: 0.9, b: -1, t: 1 },
  { nome: 'olho direito           ', l: -0.9, r: 1.2, b: -1, t: 1 },
  { nome: 'canted forte           ', l: -1.5, r: 0.6, b: -1.1, t: 0.95 },
];

let falhas = 0;

for (const sinal of [1, -1]) {
  console.log(`\n  deslocamento ${sinal > 0 ? '+P02/P00 (correto)' : '-P02/P00 (o bug)'}`);
  for (const c of CASOS) {
    const f = raio(projecao(c.l, c.r, c.b, c.t, 1, 100), sinal);
    let pior = 0;
    for (const [nx, ny, ex, ey] of [
      [-1, -1, c.l, c.b], [1, -1, c.r, c.b], [-1, 1, c.l, c.t], [1, 1, c.r, c.t],
    ]) {
      const [vx, vy] = f(nx, ny);
      pior = Math.max(pior, Math.abs(vx - ex), Math.abs(vy - ey));
    }
    const ok = pior < 1e-12;
    console.log(`    ${c.nome}  erro ${pior.toExponential(2)}  ${ok ? 'ok' : 'ERRADO'}`);
    // O sinal correto tem de acertar tudo; o errado tem de falhar em tudo que for
    // assimetrico, senao este teste nao estaria medindo nada.
    if (sinal > 0 && !ok) falhas++;
    if (sinal < 0 && ok && c.nome.trim() !== 'simetrico (tela plana)') falhas++;
  }
}

console.log(falhas ? `\n  ${falhas} falha(s)\n` : '\n  Sinal verificado, e o teste distingue as duas versoes.\n');
process.exit(falhas ? 1 : 0);
