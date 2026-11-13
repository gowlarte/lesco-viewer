/**
 * Constelação — capa alternativa do acervo.
 *
 * Mesma fonte da capa em grade (/data/index.json, que existe nas duas situações),
 * arranjo diferente: as obras espalhadas sobre preto em vez de enfileiradas. Serve
 * a um acervo que é peça de portfólio antes de ser catálogo — a primeira coisa que
 * se vê é a obra, não a ficha dela.
 *
 * O arranjo é DETERMINÍSTICO. A posição de cada obra sai de um hash do slug, então
 * a mesma obra cai no mesmo lugar em toda visita e em toda máquina. Sorteio de
 * verdade faria a capa parecer instável, e tornaria impossível dizer "aquela ali
 * no canto" para outra pessoa.
 */

import { esc, qs, LINHAS, TIPOS_OBRA, nomeTipo, local, debounce } from './comum.js';

const campo = qs('#campo');
const palco = qs('#palco');
const filtros = qs('#filtros');
const rotulo = qs('#rotulo');
const conta = qs('#conta');

/**
 * No pacote exportado cada obra é uma pasta servida como /resort-jurere; em
 * desenvolvimento é uma query no servidor do editor. Igual à capa em grade.
 */
const estatico = !!window.__ESTATICO__;
const enderecoDoTour = (slug) => (estatico ? `/${slug}/` : `/tour?t=${slug}`);

/**
 * O índice entrega a miniatura de 480px, que é o suficiente enquanto o azulejo está
 * cinza e pequeno. Sob o cursor ele cresce, ganha cor e varre na horizontal, e aí a
 * miniatura aparece macia — então a prévia de 1536px entra por cima, uma de cada vez.
 * Buscar as 20 de saída seriam 2,6 MB numa capa; assim são ~35 KB por azulejo, e o
 * resto só de quem for olhado.
 */
const previaDe = (caminhoThumb) => caminhoThumb.replace(/\.thumb\.jpg$/, '.preview.jpg');

/* ── obras de exemplo ────────────────────────────────────────────────────────
 *
 * PLACEHOLDER. Existem só para ver o arranjo povoado enquanto o acervo tem quatro
 * obras — sozinhas elas não formam constelação nenhuma. As imagens são de ambientes
 * reais do acervo, mas os nomes, cidades e linhas são inventados.
 *
 * NÃO vão para o ar: o export marca window.__ESTATICO__ e este bloco fica de fora.
 * Para ver o arranjo cheio dentro do pacote, abra a página com ?exemplos=1.
 * Quando o acervo tiver obra de verdade que chegue, apagar esta constante inteira.
 */
const EXEMPLOS = [
  ['Resort Jurerê', 'Florianópolis', 'SC', 'resort', 2025, 'Studio MK27', ['brise'], 'biotique', 'c4', 11],
  ['Sede Ventura', 'Curitiba', 'PR', 'corporativo', 2025, 'Triptyque', ['panel-shield'], 'alpha-one', 'c3', 7],
  ['Casa Aldeia', 'Trancoso', 'BA', 'residencia', 2024, 'Bernardes Arquitetura', ['green-brise'], 'lavvi', 'c2', 6],
  ['Pátio Anhembi', 'São Paulo', 'SP', 'comercial', 2025, 'Perkins&Will', ['brise', 'panel-shield'], 'biotique', 'c9', 9],
  ['Vila Serena', 'Campos do Jordão', 'SP', 'residencia', 2024, 'Jacobsen', ['green-brise'], 'alpha-one', 'c6', 5],
  ['Torre Marítima', 'Recife', 'PE', 'corporativo', 2026, 'Metro Arquitetos', ['panel-shield'], 'biotique', 'c12', 12],
  ['Hotel Cardeal', 'Belo Horizonte', 'MG', 'comercial', 2024, 'Arquitetos Associados', ['brise'], 'jha-boutique', 'c1', 8],
  ['Enseada Norte', 'Maceió', 'AL', 'resort', 2026, 'Sidonio Porto', ['green-brise', 'brise'], 'alpha-one', 'c8', 10],
  ['Edifício Mata', 'Porto Alegre', 'RS', 'residencia', 2025, 'Estúdio Módulo', ['brise'], 'biotique', 'c7', 6],
  ['Centro Aurora', 'Brasília', 'DF', 'corporativo', 2024, 'Bloco Arquitetos', ['panel-shield'], 'lavvi', 'c4', 7],
  ['Casa Duna', 'Búzios', 'RJ', 'residencia', 2026, 'mf+arquitetos', ['green-brise'], 'biotique', 'c11', 4],
  ['Galeria Pilar', 'Salvador', 'BA', 'comercial', 2025, 'Studio Guilherme Torres', ['brise'], 'alpha-one', 'c5', 5],
].map(([obra, cidade, uf, tipo, ano, escritorio, linhas, obraDaFoto, cena, totalCenas]) => ({
  slug: null, // sem slug: exemplo não é clicável, não há tour do outro lado
  obra,
  cidade,
  uf,
  tipo,
  ano,
  escritorio,
  linhas,
  totalCenas,
  capaThumb: `/media/${obraDaFoto}/${cena}.thumb.jpg`,
  exemplo: true,
}));

const mostrarExemplos = !estatico || new URLSearchParams(location.search).has('exemplos');

/* ── arranjo ─────────────────────────────────────────────────────────────── */

/** Hash curto e estável de string. Mesma obra, mesmo lugar, sempre. */
function semente(texto) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — pequeno, determinístico, e bom o bastante para espalhar imagem. */
function aleatorio(s) {
  let e = s;
  return () => {
    e = (e + 0x6d2b79f5) | 0;
    let t = Math.imul(e ^ (e >>> 15), 1 | e);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


/**
 * Proporções dos azulejos.
 *
 * A fonte é sempre 2:1, então nenhuma destas mostra o panorama inteiro — todas
 * recortam, e é isso que se quer. Variedade de forma é o que impede o arranjo de
 * parecer uma grade embaralhada.
 */
const PROPORCOES = ['4 / 3', '16 / 9', '3 / 2', '1 / 1', '5 / 4', '16 / 10', '5 / 6'];

/** Faixa de raio ocupada: nada dentro de 0.42, nada além de 1. */
const RAIO_MIN = 0.42;

/**
 * Distribui as obras ao redor do centro.
 *
 * O ângulo é dividido em fatias iguais e cada obra cai dentro da sua, deslocada por
 * um ruído menor que a fatia. Cheguei aqui depois de tentar filotaxia com ângulo
 * áureo, que é o arranjo bonito para centenas de pontos e péssimo para dezesseis:
 * com poucos itens ele empilha tudo num lado e deixa um quadrante vazio. Fatia fixa
 * garante que cada direção receba uma obra; o ruído é o que tira a cara de relógio.
 *
 * O raio alterna entre duas faixas por paridade do índice. É isso que transforma o
 * anel em constelação — sem alternância as obras caem todas na mesma órbita.
 */
function arranjar(itens) {
  const n = itens.length;
  const { width: largura, height: altura } = palco.getBoundingClientRect();
  const base = Math.max(104, Math.min(largura * 0.115, altura * 0.28));
  const fatia = (Math.PI * 2) / n;

  itens.forEach((item, i) => {
    const rnd = item.rnd;
    const angulo = i * fatia + (rnd() - 0.5) * fatia * 0.72;
    // Par vai para dentro, ímpar para fora; o ruído embaralha a alternância o
    // suficiente para ela não virar padrão visível.
    const faixa = i % 2 === 0 ? 0 : 0.46;
    const raio = RAIO_MIN + (1 - RAIO_MIN) * Math.min(1, faixa + rnd() * 0.54);

    // Mais alto que largo em porcentagem para compensar o palco, que é o contrário:
    // 33% de 1600px são 528px, 38% de 700px são 266px. Sem essa correção a
    // constelação sai achatada numa faixa.
    const rx = 29 * (1 + (rnd() - 0.5) * 0.18);
    const ry = 38 * (1 + (rnd() - 0.5) * 0.18);

    item.el.style.setProperty('--x', `${(50 + Math.cos(angulo) * raio * rx).toFixed(2)}%`);
    item.el.style.setProperty('--y', `${(50 + Math.sin(angulo) * raio * ry).toFixed(2)}%`);
    item.el.style.setProperty('--w', `${Math.round(base * (0.62 + item.prof * 0.86))}px`);
  });
}

/* ── desenho ─────────────────────────────────────────────────────────────── */

let tours = [];
let itens = [];
let filtroLinha = null;
let filtroTipo = null;

function montarItem(t, indice) {
  const chave = t.slug || `exemplo-${t.obra}`;
  const rnd = aleatorio(semente(chave));
  // Profundidade manda em três coisas de uma vez: tamanho, brilho e o quanto o
  // azulejo anda na paralaxe. Amarrar as três é o que faz ler como camada, e não
  // como três variações soltas.
  const prof = 0.3 + rnd() * 0.7;
  const proporcao = PROPORCOES[Math.floor(rnd() * PROPORCOES.length)];

  // Exemplo vira <span>: sem href não é clicável nem focável, que é o correto para
  // um azulejo sem tour do outro lado. Obra de verdade é <a>, e navega por teclado.
  const el = document.createElement(t.exemplo ? 'span' : 'a');
  el.className = 'cst-item';
  if (!t.exemplo) el.href = enderecoDoTour(t.slug);
  el.style.setProperty('--proporcao', proporcao);
  el.style.setProperty('--prof', prof.toFixed(3));
  el.style.setProperty('--z', String(10 + Math.round(prof * 20)));
  el.setAttribute('aria-label', `${t.obra}${t.exemplo ? ' (exemplo)' : ''}`);

  const img = document.createElement('img');
  img.src = t.capaThumb;
  img.alt = '';
  img.decoding = 'async';
  // Sem lazy: todos os azulejos nascem dentro da janela, e adiar só faria a
  // constelação aparecer aos pedaços.
  el.appendChild(img);

  return { t, el, img, prof, rnd, indice, nitidaPedida: false };
}

/** Sob o cursor, a prévia de 1536px entra no lugar da miniatura. */
function pedirNitida(item) {
  if (item.nitidaPedida || !item.t.capaThumb) return;
  item.nitidaPedida = true;
  const alvo = previaDe(item.t.capaThumb);
  if (alvo === item.t.capaThumb) return;

  const pre = new Image();
  // Só troca depois de estar em cache: trocar o src direto piscaria o azulejo
  // justo no instante em que ele ganhou a atenção de alguém.
  pre.onload = () => { item.img.src = alvo; };
  pre.src = alvo;
}

function textoDoRotulo(t) {
  const partes = [nomeTipo(t.tipo), local(t.cidade, t.uf), t.ano].filter(Boolean).join(' · ');
  return `<b>${esc(t.obra)}</b>${t.exemplo ? ' <span>exemplo</span>' : ''}<br><span>${esc(partes)}</span>`;
}

const ROTULO_PARADO = 'Constelação';

function desenhar() {
  const visiveis = tours.filter(
    (t) =>
      (!filtroLinha || (t.linhas || []).includes(filtroLinha)) &&
      (!filtroTipo || t.tipo === filtroTipo),
  );

  // Só oferece filtro para o que existe no acervo: pílula que não filtra nada é ruído.
  const linhasPresentes = LINHAS.filter((l) => tours.some((t) => (t.linhas || []).includes(l.id)));
  const tiposPresentes = TIPOS_OBRA.filter((tp) => tours.some((t) => t.tipo === tp.id));

  filtros.innerHTML = tours.length
    ? `<button class="cst-pill ${!filtroLinha && !filtroTipo ? 'is-on' : ''}" data-limpar>Tudo</button>
       ${linhasPresentes.map((l) => `<button class="cst-pill ${filtroLinha === l.id ? 'is-on' : ''}" data-linha="${esc(l.id)}">${esc(l.nome)}</button>`).join('')}
       ${tiposPresentes.map((tp) => `<button class="cst-pill ${filtroTipo === tp.id ? 'is-on' : ''}" data-tipo="${esc(tp.id)}">${esc(tp.nome)}</button>`).join('')}`
    : '';

  campo.innerHTML = '';
  itens = visiveis.map(montarItem);
  for (const item of itens) campo.appendChild(item.el);

  const n = visiveis.length;
  conta.textContent = n ? `${n} ${n === 1 ? 'obra' : 'obras'}` : '';

  if (!n) {
    campo.innerHTML = `<p class="cst-vazio">${
      tours.length ? 'Nenhuma obra com esse recorte.' : 'Os tours aparecem aqui quando são publicados.'
    }</p>`;
    return;
  }
  arranjar(itens);
}

/* ── paralaxe e rótulo ───────────────────────────────────────────────────── */

let alvoX = 0;
let alvoY = 0;
let quadroPedido = false;

/**
 * A paralaxe é a única coisa que se move sem alguém pedir, então é discreta: 26px no
 * canto da tela, e só para quem está na frente. Passa dali e vira enjoo de parallax
 * de site de agência.
 */
const AMPLITUDE = 26;

function aoMoverPonteiro(e) {
  const r = palco.getBoundingClientRect();
  alvoX = ((e.clientX - r.left) / r.width - 0.5) * -2 * AMPLITUDE;
  alvoY = ((e.clientY - r.top) / r.height - 0.5) * -2 * AMPLITUDE;
  if (quadroPedido) return;
  quadroPedido = true;
  requestAnimationFrame(() => {
    quadroPedido = false;
    campo.style.setProperty('--mx', `${alvoX.toFixed(1)}px`);
    campo.style.setProperty('--my', `${alvoY.toFixed(1)}px`);
  });
}

// Ponteiro grosso não tem hover: num toque a paralaxe seria um salto na primeira
// batida do dedo, e o efeito existe justamente por ser contínuo.
if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
  palco.addEventListener('pointermove', aoMoverPonteiro);
  palco.addEventListener('pointerleave', () => {
    campo.style.setProperty('--mx', '0px');
    campo.style.setProperty('--my', '0px');
  });
}

// O nome da obra vive no pé, e não colado no azulejo: sobre foto, legenda é ruído,
// e no pé ela sempre cai no mesmo lugar — o olho aprende onde procurar.
campo.addEventListener('pointerover', (e) => {
  const el = e.target.closest('.cst-item');
  if (!el) return;
  const item = itens.find((x) => x.el === el);
  if (!item) return;
  rotulo.innerHTML = textoDoRotulo(item.t);
  pedirNitida(item);
});
campo.addEventListener('pointerout', (e) => {
  if (e.target.closest('.cst-item') && !campo.contains(e.relatedTarget)) rotulo.textContent = ROTULO_PARADO;
});
campo.addEventListener('focusin', (e) => {
  const item = itens.find((x) => x.el === e.target.closest('.cst-item'));
  if (!item) return;
  rotulo.innerHTML = textoDoRotulo(item.t);
  pedirNitida(item);
});
campo.addEventListener('focusout', () => { rotulo.textContent = ROTULO_PARADO; });

filtros.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.limpar !== undefined) {
    filtroLinha = null;
    filtroTipo = null;
  } else if (b.dataset.linha) {
    filtroLinha = filtroLinha === b.dataset.linha ? null : b.dataset.linha;
  } else if (b.dataset.tipo) {
    filtroTipo = filtroTipo === b.dataset.tipo ? null : b.dataset.tipo;
  }
  desenhar();
});

// Rearranjar e não reconstruir: o azulejo continua o mesmo nó, então quem está com
// o cursor em cima não perde o hover ao girar o telefone ou arrastar a janela.
window.addEventListener('resize', debounce(() => { if (itens.length) arranjar(itens); }, 160));

/* ── entrada ─────────────────────────────────────────────────────────────── */

(async () => {
  try {
    const resposta = await fetch('/data/index.json');
    if (!resposta.ok) throw new Error(`índice indisponível (${resposta.status})`);
    const dados = await resposta.json();
    // Em desenvolvimento o índice traz rascunhos; a capa pública mostra só publicados.
    const reais = (dados.tours || []).filter((t) => t.publicado);
    tours = mostrarExemplos ? [...reais, ...EXEMPLOS] : reais;
    desenhar();
  } catch (e) {
    campo.innerHTML = `<p class="cst-vazio">${esc(e.message)}</p>`;
  }
})();
