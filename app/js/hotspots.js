/**
 * Camada de hotspots — botões HTML posicionados sobre o canvas.
 *
 * Ficam fora do WebGL de propósito: assim herdam o design system inteiro (traço
 * hairline, raio de 4px, tipografia Archivo) e continuam sendo <button> de verdade,
 * navegáveis por tab e legíveis por leitor de tela. Um marcador desenhado dentro da
 * textura não teria nenhuma dessas duas coisas.
 *
 * A camada em si é pointer-events:none; só os botões capturam. É o que permite o
 * editor receber o clique no panorama para posicionar um hotspot novo.
 */

import { esc, grausDaSeta } from './comum.js';
import { icone } from './icones.js';

/**
 * @param {HTMLElement} camada  div sobreposta ao canvas
 * @param {object} pano         instância de criarPanorama
 * @param {{
 *   editavel?: boolean,
 *   aoAcionar?: (hotspot) => void,
 *   aoSelecionar?: (hotspot) => void,
 *   aoMoverHotspot?: (hotspot, yaw, pitch) => void,
 *   rotuloDestino?: (id) => string,
 * }} opcoes
 */
export function criarCamadaHotspots(camada, pano, opcoes = {}) {
  const {
    editavel = false,
    aoAcionar = () => {},
    aoSelecionar = () => {},
    aoMoverHotspot = () => {},
    rotuloDestino = () => '',
  } = opcoes;

  let lista = [];
  let selecionadoId = null;
  const nos = new Map();

  function rotuloDe(h) {
    if (h.tipo === 'navegacao') return rotuloDestino(h.destinoId) || 'Ambiente';
    return h.titulo || 'Informação';
  }

  function montar(h) {
    const navegacao = h.tipo === 'navegacao';
    const rotulo = rotuloDe(h);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `hs hs-${navegacao ? 'nav' : 'info'}`;
    el.dataset.id = h.id;
    el.setAttribute(
      'aria-label',
      navegacao ? `Ir para ${rotulo}` : `Informação: ${rotulo}`,
    );
    // A seta aponta para onde o ambiente fica de verdade — porta à esquerda, escada
    // para cima. É o mesmo desenho girado; --giro é lido pelo .hs-glifo no CSS.
    const giro = navegacao ? grausDaSeta(h.direcao) : 0;
    el.innerHTML = `
      <span class="hs-marca" aria-hidden="true">
        <span class="hs-pulso"></span>
        <span class="hs-glifo" style="--giro:${giro}deg">${icone(navegacao ? 'seta' : 'mais', 15, 1.75)}</span>
      </span>
      <span class="hs-rotulo">${esc(rotulo)}</span>`;
    return el;
  }

  /** Reposiciona tudo. Chamado a cada quadro em que a câmera mudou. */
  function atualizar() {
    if (!lista.length) return;
    const meio = { x: camada.clientWidth / 2, y: camada.clientHeight / 2 };

    for (const h of lista) {
      const el = nos.get(h.id);
      if (!el) continue;
      const p = pano.projetar(h.yaw, h.pitch);
      if (!p.visivel) {
        el.hidden = true;
        continue;
      }
      el.hidden = false;
      el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      // Quem está mais perto do centro fica por cima, e o rótulo abre para dentro
      // da tela em vez de vazar pela borda.
      const dist = Math.hypot(p.x - meio.x, p.y - meio.y);
      el.style.zIndex = String(Math.max(1, 999 - Math.round(dist)));
      el.dataset.lado = p.x > meio.x ? 'esquerda' : 'direita';
    }
  }

  function definir(novaLista) {
    lista = Array.isArray(novaLista) ? novaLista : [];
    const vivos = new Set(lista.map((h) => h.id));

    for (const [id, el] of nos) {
      if (!vivos.has(id)) {
        el.remove();
        nos.delete(id);
      }
    }
    for (const h of lista) {
      let el = nos.get(h.id);
      if (!el) {
        el = montar(h);
        nos.set(h.id, el);
        camada.appendChild(el);
      } else {
        // rótulo e tipo podem ter mudado na edição
        const novo = montar(h);
        el.className = novo.className;
        el.innerHTML = novo.innerHTML;
        el.setAttribute('aria-label', novo.getAttribute('aria-label'));
      }
      el.classList.toggle('is-sel', editavel && h.id === selecionadoId);
    }
    atualizar();
  }

  function selecionar(id) {
    selecionadoId = id;
    for (const [outroId, el] of nos) el.classList.toggle('is-sel', editavel && outroId === id);
  }

  // ── interação ─────────────────────────────────────────────────────────────

  let arraste = null;

  camada.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.hs');
    if (!el) return;
    const h = lista.find((x) => x.id === el.dataset.id);
    if (!h) return;

    if (!editavel) return; // no lado público o clique simples resolve tudo

    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    arraste = { h, el, id: e.pointerId, x0: e.clientX, y0: e.clientY, andou: 0 };
    selecionar(h.id);
    aoSelecionar(h);
  });

  camada.addEventListener('pointermove', (e) => {
    if (!arraste || e.pointerId !== arraste.id) return;
    arraste.andou += Math.abs(e.clientX - arraste.x0) + Math.abs(e.clientY - arraste.y0);
    arraste.x0 = e.clientX;
    arraste.y0 = e.clientY;
    if (arraste.andou < 4) return; // tolerância: mão tremida ao clicar não conta como arrasto

    arraste.el.classList.add('is-arrastando');
    const r = camada.getBoundingClientRect();
    const { yaw, pitch } = pano.doEcra(e.clientX - r.left, e.clientY - r.top);
    arraste.h.yaw = yaw;
    arraste.h.pitch = pitch;
    atualizar();
  });

  const encerrarArraste = (e) => {
    if (!arraste || e.pointerId !== arraste.id) return;
    const { h, el, andou } = arraste;
    arraste = null;
    el.classList.remove('is-arrastando');
    if (andou >= 4) aoMoverHotspot(h, h.yaw, h.pitch);
  };
  camada.addEventListener('pointerup', encerrarArraste);
  camada.addEventListener('pointercancel', encerrarArraste);

  camada.addEventListener('click', (e) => {
    const el = e.target.closest('.hs');
    if (!el) return;
    e.stopPropagation();
    const h = lista.find((x) => x.id === el.dataset.id);
    if (!h) return;
    // No editor o clique seleciona (o arrasto já tratou o resto); no público, aciona.
    if (editavel) aoSelecionar(h);
    else aoAcionar(h);
  });

  return { definir, atualizar, selecionar, get lista() { return lista; } };
}
