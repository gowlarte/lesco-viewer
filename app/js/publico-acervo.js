/**
 * Acervo público — capa com as obras publicadas.
 *
 * Lê /data/index.json, que existe nas duas situações: em desenvolvimento o servidor
 * gera na hora, no pacote exportado é um arquivo real. Mesmo código, mesma URL.
 */

import { icone } from './icones.js';
import {
  esc, qs, LINHAS, TIPOS_OBRA, etiquetaLinha, nomeTipo, local,
} from './comum.js';

const grade = qs('#grade');
const filtros = qs('#filtros');

/**
 * No pacote exportado cada obra é uma pasta servida como /resort-jurere; em
 * desenvolvimento é uma query no servidor do editor. O export injeta a marca.
 */
const estatico = !!window.__ESTATICO__;
const enderecoDoTour = (slug) => (estatico ? `/${slug}/` : `/tour?t=${slug}`);

let tours = [];
let filtroLinha = null;
let filtroTipo = null;

function obra(t) {
  const capa = t.capaThumb
    ? `<img src="${esc(t.capaThumb)}" alt="Vista de ${esc(t.obra)}" loading="lazy">`
    : '';
  const meta = [nomeTipo(t.tipo), t.ano].filter(Boolean).join(' · ');

  return `
    <a class="obra" href="${esc(enderecoDoTour(t.slug))}">
      <div class="obra-capa">
        ${capa}
        <span class="obra-cenas">${t.totalCenas} ${t.totalCenas === 1 ? 'ambiente' : 'ambientes'}</span>
      </div>
      <div class="obra-corpo">
        <h2 class="obra-nome">${esc(t.obra)}</h2>
        ${local(t.cidade, t.uf)
          ? `<div class="obra-linha-meta">${icone('local', 13)}<span>${esc(local(t.cidade, t.uf))}</span></div>`
          : ''}
        <div class="obra-linha-meta">${icone('obra', 13)}<span>${esc(meta)}</span></div>
        ${t.escritorio
          ? `<div class="obra-linha-meta">${icone('lapis', 13)}<span>${esc(t.escritorio)}</span></div>`
          : ''}
        ${t.linhas.length ? `<div class="obra-tags">${t.linhas.map(etiquetaLinha).join('')}</div>` : ''}
      </div>
    </a>`;
}

function desenhar() {
  const visiveis = tours.filter(
    (t) =>
      (!filtroLinha || t.linhas.includes(filtroLinha)) &&
      (!filtroTipo || t.tipo === filtroTipo),
  );

  // Só oferece filtro para o que existe no acervo: pílula que não filtra nada é ruído.
  const linhasPresentes = LINHAS.filter((l) => tours.some((t) => t.linhas.includes(l.id)));
  const tiposPresentes = TIPOS_OBRA.filter((tp) => tours.some((t) => t.tipo === tp.id));

  filtros.innerHTML = tours.length
    ? `<span class="field-label">FILTRAR</span>
       <button class="pill ${!filtroLinha && !filtroTipo ? 'is-on' : ''}" data-limpar>Tudo</button>
       ${linhasPresentes.map((l) => `<button class="pill ${filtroLinha === l.id ? 'is-on' : ''}" data-linha="${l.id}">${esc(l.nome)}</button>`).join('')}
       ${tiposPresentes.map((tp) => `<button class="pill ${filtroTipo === tp.id ? 'is-on' : ''}" data-tipo="${tp.id}">${esc(tp.nome)}</button>`).join('')}`
    : '';

  if (!tours.length) {
    grade.innerHTML = `
      <div class="vazio">
        ${icone('camadas', 26)}
        <h2 class="h4">Nenhuma obra publicada</h2>
        <p class="body">Os tours aparecem aqui quando são publicados.</p>
      </div>`;
    return;
  }
  if (!visiveis.length) {
    grade.innerHTML = `<div class="vazio">${icone('busca', 24)}<p class="body">Nenhuma obra com esse recorte.</p></div>`;
    return;
  }
  grade.innerHTML = `<div class="grade-acervo">${visiveis.map(obra).join('')}</div>`;
}

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

(async () => {
  try {
    const resposta = await fetch('/data/index.json');
    if (!resposta.ok) throw new Error(`índice indisponível (${resposta.status})`);
    const dados = await resposta.json();
    // Em desenvolvimento o índice traz rascunhos; a capa pública mostra só publicados.
    tours = (dados.tours || []).filter((t) => t.publicado);
    desenhar();
  } catch (e) {
    grade.innerHTML = `<div class="vazio">${icone('alerta', 24)}<p class="body">${esc(e.message)}</p></div>`;
  }
})();
