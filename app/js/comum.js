/** Utilidades compartilhadas entre a gestão e o lado público. */

/** Escapa para interpolação segura em template de HTML. */
export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const qs = (sel, raiz = document) => raiz.querySelector(sel);
export const qsa = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/** Cria elemento a partir de HTML. Devolve o primeiro nó. */
export function no(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function debounce(fn, ms = 300) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

let idToast = 0;
/**
 * Aviso curto no pé da tela. Some sozinho; erro fica mais tempo.
 *
 * `acao` acrescenta um botão ao lado do texto. Existe para o caso em que o aviso
 * conta um problema e a correção é um clique — dizer "o pacote ficou velho" sem
 * oferecer regerar seria dar trabalho em vez de resolver.
 */
export function aviso(texto, { erro = false, ms, acao = null } = {}) {
  const anterior = qs('.toast');
  if (anterior) anterior.remove();
  const el = no(`
    <div class="toast ${erro ? 'toast-erro' : ''}" role="status" aria-live="polite">
      <span>${esc(texto)}</span>
      ${acao ? `<button class="toast-acao">${esc(acao.rotulo)}</button>` : ''}
    </div>`);
  if (acao) {
    el.querySelector('.toast-acao').addEventListener('click', () => {
      el.remove();
      acao.aoClicar();
    });
  }
  document.body.appendChild(el);
  const meu = ++idToast;
  setTimeout(() => {
    if (meu === idToast) el.remove();
  }, ms ?? (erro ? 6000 : 3200));
}

/** Confirmação em painel, no lugar do confirm() do navegador. */
export function confirmar({ titulo, texto, confirmar: rotulo = 'Confirmar', perigo = false }) {
  return new Promise((resolve) => {
    const scrim = no('<div class="scrim"></div>');
    const painel = no(`
      <div class="painel painel-confirma" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
        <div class="painel-topo"><h2 class="h3">${esc(titulo)}</h2></div>
        <div class="painel-corpo"><p class="body">${esc(texto)}</p></div>
        <div class="painel-pe">
          <div class="dupla">
            <button class="btn btn-secondary" data-r="0">Cancelar</button>
            <button class="btn ${perigo ? 'btn-perigo' : 'btn-primary'}" data-r="1">${esc(rotulo)}</button>
          </div>
        </div>
      </div>`);

    const fechar = (valor) => {
      scrim.remove();
      painel.remove();
      document.removeEventListener('keydown', aoTeclar);
      resolve(valor);
    };
    const aoTeclar = (e) => {
      if (e.key === 'Escape') fechar(false);
    };

    painel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (b) fechar(b.dataset.r === '1');
    });
    scrim.addEventListener('click', () => fechar(false));
    document.addEventListener('keydown', aoTeclar);
    document.body.append(scrim, painel);
    // Em ação destrutiva o foco começa em Cancelar: um Enter reflexo não deve apagar
    // uma obra. Nas demais, confirmar é o caminho esperado e recebe o foco.
    painel.querySelector(perigo ? '[data-r="0"]' : '[data-r="1"]').focus();
  });
}

// ── vocabulário do produto ─────────────────────────────────────────────────

export const LINHAS = [
  { id: 'panel-shield', nome: 'Panel Shield' },
  { id: 'brise', nome: 'Brise' },
  { id: 'green-brise', nome: 'Lesco Green Brise' },
];

export const TIPOS_OBRA = [
  { id: 'resort', nome: 'Resort' },
  { id: 'residencia', nome: 'Residência' },
  { id: 'comercial', nome: 'Comercial' },
  { id: 'corporativo', nome: 'Corporativo' },
];

export const nomeLinha = (id) => LINHAS.find((l) => l.id === id)?.nome || id;
export const nomeTipo = (id) => TIPOS_OBRA.find((t) => t.id === id)?.nome || id;

/** Leitura da câmera em graus: giro, inclinação e abertura. */
export function formatarVista(v) {
  const g = (rad) => `${Math.round((rad * 180) / Math.PI)}°`;
  return `giro ${g(v.yaw)} · inclinação ${g(v.pitch)} · abertura ${Math.round(v.fov)}°`;
}

/** "Florianópolis · SC" — omite o separador quando falta uma das partes. */
export function local(cidade, uf) {
  return [cidade, uf].filter(Boolean).join(' · ');
}

/** Etiqueta de linha com o acento da própria linha no traço. */
export function etiquetaLinha(id) {
  return `<span class="tag" data-linha="${esc(id)}">${esc(nomeLinha(id))}</span>`;
}

export const UFS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE',
  'PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
];

// ── direção da seta de passagem ────────────────────────────────────────────

/**
 * Para onde a seta do ponto de passagem aponta.
 *
 * O ícone base é a seta para a direita; cada direção é só um giro sobre ela — um path
 * por direção seria oito vezes o mesmo desenho. Guardar o nome em vez do ângulo mantém
 * o JSON do tour legível para quem abre o arquivo na mão.
 *
 * A ordem é a leitura da rosa 3×3, de cima à esquerda para baixo à direita.
 */
export const DIRECOES_SETA = [
  { id: 'cima-esquerda',  nome: 'Cima e esquerda',  graus: -135 },
  { id: 'cima',           nome: 'Cima',             graus:  -90 },
  { id: 'cima-direita',   nome: 'Cima e direita',   graus:  -45 },
  { id: 'esquerda',       nome: 'Esquerda',         graus:  180 },
  { id: 'direita',        nome: 'Direita',          graus:    0 },
  { id: 'baixo-esquerda', nome: 'Baixo e esquerda', graus:  135 },
  { id: 'baixo',          nome: 'Baixo',            graus:   90 },
  { id: 'baixo-direita',  nome: 'Baixo e direita',  graus:   45 },
];

/** O que o ícone sempre foi antes do campo existir — tour antigo continua igual. */
export const DIRECAO_PADRAO = 'direita';

/** Giro em graus da seta. Tolera hotspot sem o campo e valor que não existe mais. */
export const grausDaSeta = (id) => DIRECOES_SETA.find((d) => d.id === id)?.graus ?? 0;

export const nomeDirecao = (id) => DIRECOES_SETA.find((d) => d.id === id)?.nome || 'Direita';
