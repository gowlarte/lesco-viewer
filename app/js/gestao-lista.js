/** Gestão — listagem das obras. */

import { api } from './api.js';
import { icone, hidratarIcones } from './icones.js';
import {
  esc, qs, no, aviso, confirmar,
  TIPOS_OBRA, UFS, etiquetaLinha, nomeTipo, local,
} from './comum.js';

const grade = qs('#grade');
const filtros = qs('#filtros');
let tours = [];
let filtro = 'todos';

const FILTROS = [
  { id: 'todos', nome: 'Todos' },
  { id: 'publicado', nome: 'Publicados' },
  { id: 'rascunho', nome: 'Rascunhos' },
];

function cartao(t) {
  const capa = t.capaThumb
    ? `<img src="${esc(t.capaThumb)}" alt="" loading="lazy">`
    : icone('imagem', 26);

  return `
    <article class="cartao-tour">
      <div class="cartao-capa">
        ${capa}
        <span class="selo ${t.publicado ? 'selo-publicado' : ''}">${t.publicado ? 'Publicado' : 'Rascunho'}</span>
        ${t.pacoteDesatualizado
          ? `<span class="selo selo-desatualizado" title="A ficha foi editada depois do último pacote: o que está no ar não é o que está aqui">Pacote desatualizado</span>`
          : ''}
      </div>
      <div class="cartao-corpo">
        <h2 class="cartao-titulo">${esc(t.obra || 'Obra sem nome')}</h2>
        <div class="cartao-meta">
          ${icone('local', 13)}<span>${esc(local(t.cidade, t.uf) || 'Local não informado')}</span>
        </div>
        <div class="cartao-meta">
          ${icone('obra', 13)}<span>${esc(nomeTipo(t.tipo))}${t.ano ? ` · ${t.ano}` : ''}</span>
        </div>
        ${t.linhas.length ? `<div class="cartao-tags">${t.linhas.map(etiquetaLinha).join('')}</div>` : ''}
        <div class="cartao-pe">
          <span class="meta">${t.totalCenas} ${t.totalCenas === 1 ? 'ambiente' : 'ambientes'}</span>
          ${t.totalCenas ? `<a class="btn btn-secondary btn-sm" href="/tour?t=${esc(t.slug)}" target="_blank" rel="noopener">Ver</a>` : ''}
          <a class="btn btn-primary btn-sm" href="/gestao/tour?t=${esc(t.slug)}">Editar</a>
          <button class="cartao-excluir" data-excluir="${esc(t.slug)}"
                  title="Excluir esta obra" aria-label="Excluir ${esc(t.obra || 'obra sem nome')}">
            ${icone('lixo', 15)}
          </button>
        </div>
      </div>
    </article>`;
}

function desenhar() {
  const visiveis = tours.filter((t) =>
    filtro === 'todos' ? true : filtro === 'publicado' ? t.publicado : !t.publicado,
  );

  qs('#contaNav').textContent = tours.length || '';
  const publicados = tours.filter((t) => t.publicado).length;

  // Publicar continua sendo acao explicita — regerar 700 MB a cada Ctrl+S nao se
  // sustenta. O que muda aqui e a divergencia deixar de ser silenciosa.
  const atrasadas = tours.filter((t) => t.pacoteDesatualizado).length;
  qs('#resumoPublica').textContent = atrasadas
    ? `${atrasadas} ${atrasadas === 1 ? 'obra editada' : 'obras editadas'} depois do último pacote`
    : publicados
      ? `${publicados} de ${tours.length} ${tours.length === 1 ? 'obra' : 'obras'} pronta${publicados === 1 ? '' : 's'} para publicar`
      : 'Nenhuma obra publicada ainda';

  const btExportar = qs('#btExportar');
  btExportar.disabled = publicados === 0;
  btExportar.classList.toggle('tem-pendencia', atrasadas > 0);

  filtros.innerHTML = FILTROS.map(
    (f) => `<button class="pill ${filtro === f.id ? 'is-on' : ''}" data-filtro="${f.id}">${f.nome}</button>`,
  ).join('');

  if (!tours.length) {
    grade.innerHTML = `
      <div class="vazio">
        ${icone('camadas', 26)}
        <h2 class="h4">Nenhum tour ainda</h2>
        <p class="body" style="max-width:44ch">Comece criando o tour de uma obra entregue. Depois suba
          os panoramas de cada ambiente e ligue um ao outro.</p>
        <button class="btn btn-primary" data-novo style="margin-top:6px">Criar o primeiro tour</button>
      </div>`;
    return;
  }
  if (!visiveis.length) {
    grade.innerHTML = `<div class="vazio">${icone('busca', 24)}<p class="body">Nenhuma obra nesta situação.</p></div>`;
    return;
  }
  grade.innerHTML = `<div class="grade-tours">${visiveis.map(cartao).join('')}</div>`;
}

async function carregar() {
  try {
    const dados = await api.listarTours();
    tours = dados.tours;
    desenhar();
  } catch (e) {
    grade.innerHTML = `<div class="vazio">${icone('alerta', 24)}<p class="body">${esc(e.message)}</p></div>`;
  }
}

// ── novo tour ───────────────────────────────────────────────────────────────

function abrirNovo() {
  const scrim = no('<div class="scrim"></div>');
  const painel = no(`
    <form class="painel" role="dialog" aria-modal="true" aria-label="Novo tour">
      <div class="painel-topo">
        <div>
          <div class="eyebrow">NOVA OBRA</div>
          <h2 class="h3" style="margin-top:5px">Criar tour</h2>
        </div>
      </div>
      <div class="painel-corpo">
        <div class="field-group">
          <label class="field-label" for="nObra">Nome da obra</label>
          <input class="field" id="nObra" name="obra" required maxlength="90"
                 placeholder="Resort Jurerê Internacional" autocomplete="off">
          <div class="field-nota">Define o endereço público do tour. Pode ser ajustado depois na ficha.</div>
        </div>
        <div class="field-dupla">
          <div class="field-group">
            <label class="field-label" for="nCidade">Cidade</label>
            <input class="field" id="nCidade" name="cidade" maxlength="60" placeholder="Florianópolis" autocomplete="off">
          </div>
          <div class="field-group">
            <label class="field-label" for="nUf">UF</label>
            <select class="field" id="nUf" name="uf">
              <option value="">—</option>
              ${UFS.map((u) => `<option value="${u}">${u}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field-dupla">
          <div class="field-group">
            <label class="field-label" for="nTipo">Tipo</label>
            <select class="field" id="nTipo" name="tipo">
              ${TIPOS_OBRA.map((t) => `<option value="${t.id}">${t.nome}</option>`).join('')}
            </select>
          </div>
          <div class="field-group">
            <label class="field-label" for="nAno">Ano de entrega</label>
            <input class="field" id="nAno" name="ano" type="number" inputmode="numeric"
                   min="1990" max="2100" value="${new Date().getFullYear()}">
          </div>
        </div>
        <div class="field-group">
          <label class="field-label" for="nEscritorio">Arquiteto ou escritório</label>
          <input class="field" id="nEscritorio" name="escritorio" maxlength="90" autocomplete="off">
        </div>
      </div>
      <div class="painel-pe">
        <div class="dupla">
          <button type="button" class="btn btn-secondary" data-cancelar>Cancelar</button>
          <button type="submit" class="btn btn-primary">Criar e subir fotos</button>
        </div>
      </div>
    </form>`);

  const fechar = () => {
    scrim.remove();
    painel.remove();
    document.removeEventListener('keydown', aoTeclar);
  };
  const aoTeclar = (e) => e.key === 'Escape' && fechar();

  painel.querySelector('[data-cancelar]').addEventListener('click', fechar);
  scrim.addEventListener('click', fechar);
  document.addEventListener('keydown', aoTeclar);

  painel.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(painel));
    dados.ano = Number(dados.ano) || null;
    const enviar = painel.querySelector('[type="submit"]');
    enviar.disabled = true;
    try {
      const tour = await api.criarTour(dados);
      location.href = `/gestao/tour?t=${tour.slug}`;
    } catch (err) {
      aviso(err.message, { erro: true });
      enviar.disabled = false;
    }
  });

  document.body.append(scrim, painel);
  painel.querySelector('#nObra').focus();
}

// ── excluir ─────────────────────────────────────────────────────────────────

/**
 * Exclusão de obra.
 *
 * Apaga o tour.json e a pasta de mídia. Não há lixeira, não há git neste projeto e os
 * panoramas originais moram fora daqui — então isto é definitivo, e a confirmação diz
 * exatamente o que se perde em vez de perguntar "tem certeza?".
 */
async function excluirTour(slug) {
  const t = tours.find((x) => x.slug === slug);
  if (!t) return;

  const perdas = [
    `${t.totalCenas} ${t.totalCenas === 1 ? 'ambiente' : 'ambientes'}`,
    t.totalCenas ? `${t.totalCenas * 3} arquivos de imagem` : null,
  ].filter(Boolean).join(' e ');

  const ok = await confirmar({
    titulo: `Excluir "${t.obra || 'obra sem nome'}"?`,
    texto: `Apaga a ficha da obra${t.totalCenas ? ` e ${perdas}` : ''}. `
      + 'Não há como desfazer: os panoramas processados são apagados do disco e só voltam '
      + 'subindo os originais outra vez.'
      + (t.publicado ? ' A obra está publicada e vai sair do acervo no próximo pacote.' : ''),
    confirmar: 'Excluir definitivamente',
    perigo: true,
  });
  if (!ok) return;

  try {
    await api.removerTour(slug);
    aviso(`"${t.obra || slug}" foi excluída.`);
    // Publicada significa que estava no pacote: regerar deixa o acervo honesto na hora,
    // pela mesma razão que publicar regera.
    if (t.publicado) {
      try {
        const r = await api.exportar();
        aviso(`Pacote regerado com ${r.tours} ${r.tours === 1 ? 'obra' : 'obras'}.`, { ms: 5000 });
      } catch (err) {
        aviso(`Excluída, mas o pacote não foi regerado: ${err.message}`, { erro: true });
      }
    }
    await carregar();
  } catch (e) {
    aviso(e.message, { erro: true });
  }
}

// ── eventos ─────────────────────────────────────────────────────────────────

document.addEventListener('click', async (e) => {
  const f = e.target.closest('[data-filtro]');
  if (f) {
    filtro = f.dataset.filtro;
    desenhar();
    return;
  }
  if (e.target.closest('#btNovo, [data-novo]')) {
    abrirNovo();
    return;
  }

  const bx = e.target.closest('[data-excluir]');
  if (bx) {
    await excluirTour(bx.dataset.excluir);
    return;
  }
  if (e.target.closest('#btExportar')) {
    const bt = qs('#btExportar');
    const ok = await confirmar({
      titulo: 'Gerar pacote público',
      texto: 'Reconstrói a pasta dist/ com as obras publicadas. Rascunhos ficam de fora. '
        + 'O conteúdo anterior de dist/ é substituído.',
      confirmar: 'Gerar',
    });
    if (!ok) return;
    bt.disabled = true;
    bt.textContent = 'Gerando…';
    try {
      const r = await api.exportar();
      // Um toast por vez: aviso() derruba o anterior, então os avisos do export vão
      // juntos ou não seriam lidos.
      const extras = (r.avisos || []).join(' ');
      aviso(
        `Pacote gerado com ${r.tours} ${r.tours === 1 ? 'obra' : 'obras'} em dist/.${extras ? ` ${extras}` : ''}`,
        { ms: extras ? 11000 : 5000 },
      );
      // O que estava divergente deixou de estar: a listagem tem que parar de dizer que está.
      await carregar();
    } catch (err) {
      aviso(err.message, { erro: true });
    } finally {
      bt.disabled = false;
      bt.innerHTML = `${icone('pacote', 16)}Gerar pacote público`;
    }
  }
});

hidratarIcones();
carregar();
