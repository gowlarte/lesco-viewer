/** Gestão — editor de um tour: ambientes, pontos de passagem e hotspots de informação. */

import { criarPanorama, FOV_PADRAO } from './panorama.js';
import { criarCamadaHotspots } from './hotspots.js';
import {
  api, caminhosDaCena, nomesDeArquivo, caminhoCompartilhar, ARQUIVO_COMPARTILHAR,
} from './api.js';
import {
  prepararPanorama, prepararMedia, prepararCompartilhar,
  formatarBytes, LIMITE_UPLOAD, LARGURA_MEDIA,
  LARGURA_COMPARTILHAR, ALTURA_COMPARTILHAR,
} from './imagem.js';
import { icone, hidratarIcones } from './icones.js';
import { qrSvg } from './qr.js';
import {
  esc, qs, no, aviso, confirmar, debounce,
  LINHAS, TIPOS_OBRA, UFS, nomeTipo, formatarVista,
  DIRECOES_SETA, DIRECAO_PADRAO, grausDaSeta,
} from './comum.js';

const slug = new URLSearchParams(location.search).get('t');

const el = {
  palco: qs('#palco'),
  tela: qs('#tela'),
  camadaHs: qs('#camadaHs'),
  listaCenas: qs('#listaCenas'),
  contaCenas: qs('#contaCenas'),
  inspetor: qs('#inspetor'),
  barraPalco: qs('#barraPalco'),
  dica: qs('#dicaPalco'),
  leitura: qs('#leituraCamera'),
  carregando: qs('#carregando'),
  avisoPalco: qs('#avisoPalco'),
  avisoPalcoTexto: qs('#avisoPalcoTexto'),
  obraNome: qs('#obraNome'),
  obraEyebrow: qs('#obraEyebrow'),
  estadoSalvo: qs('#estadoSalvo'),
  swPublicado: qs('#swPublicado'),
  rotuloPublicado: qs('#rotuloPublicado'),
  btSalvar: qs('#btSalvar'),
  btVer: qs('#btVer'),
  btQr: qs('#btQr'),
  solta: qs('#solta'),
  arquivos: qs('#arquivos'),
  filaUpload: qs('#filaUpload'),
  manutencao: qs('#manutencao'),
};

let tour = null;
let cenaAtualId = null;
let hsSelId = null;
let sujo = false;
let modo = null; // null | 'navegacao' | 'info'
let pano = null;
let camada = null;

const cenaAtual = () => tour?.cenas.find((c) => c.id === cenaAtualId) || null;
const nomeCena = (id) => tour?.cenas.find((c) => c.id === id)?.nome || '';

/** ids sequenciais e curtos, no formato que o servidor aceita como nome de mídia */
function proximoId(prefixo, existentes) {
  const usados = new Set(existentes);
  for (let n = 1; ; n += 1) {
    const id = `${prefixo}${n}`;
    if (!usados.has(id)) return id;
  }
}

// ── estado salvo ────────────────────────────────────────────────────────────

function marcarSujo() {
  sujo = true;
  el.estadoSalvo.hidden = false;
  el.estadoSalvo.innerHTML = `${icone('lapis', 12)} alterações não salvas`;
  el.btSalvar.classList.remove('btn-secondary');
  el.btSalvar.classList.add('btn-primary');
}

async function salvar({ silencioso = false } = {}) {
  if (!tour) return;
  el.btSalvar.disabled = true;
  try {
    const salvo = await api.salvarTour(slug, tour);
    tour.atualizadoEm = salvo.atualizadoEm;
    sujo = false;
    el.estadoSalvo.hidden = false;
    el.estadoSalvo.innerHTML = `${icone('check', 12)} salvo`;
    // Salvar obra publicada deixa o que está no ar para trás na mesma hora. Dizer
    // isso agora, com o botão do lado, evita a descoberta acontecer semanas depois —
    // ou nunca, que foi o que aconteceu com biotique em 01/09.
    if (!silencioso) {
      if (tour.publicado) {
        aviso('Tour salvo. O pacote público ficou para trás.', {
          ms: 9000,
          acao: { rotulo: 'Regerar agora', aoClicar: regerarPacote },
        });
      } else {
        aviso('Tour salvo.');
      }
    }
  } catch (e) {
    aviso(e.message, { erro: true });
  } finally {
    el.btSalvar.disabled = false;
  }
}

/**
 * QR do endereço deste tour na rede local.
 *
 * Só aparece com o servidor em `--rede` — em 127.0.0.1 o QR levaria o headset ao
 * próprio headset. O codificador é o de app/js/qr.js: um serviço externo exigiria
 * internet e mandaria o endereço da rede interna para fora, e nenhuma das duas
 * coisas se justifica para desenhar 25 quadradinhos.
 */
async function abrirQr() {
  let rede;
  try {
    rede = await api.rede();
  } catch (e) {
    aviso(`Não foi possível ler o endereço da rede: ${e.message}`, { erro: true });
    return;
  }
  if (!rede.enderecos.length) {
    aviso('Nenhum endereço de rede encontrado nesta máquina.', { erro: true });
    return;
  }

  const url = (host) => `${rede.esquema}://${host}:${rede.porta}/tour?t=${slug}`;
  const scrim = no('<div class="scrim"></div>');
  const painel = no(`
    <div class="painel painel-qr" role="dialog" aria-modal="true" aria-label="Abrir na rede local">
      <div class="painel-topo">
        <div>
          <div class="eyebrow">REDE LOCAL</div>
          <h2 class="h3" style="margin-top:5px">Abrir no headset</h2>
        </div>
      </div>
      <div class="painel-corpo">
        <div class="qr-alvo" id="qrAlvo"></div>
        <div class="qr-endereco" id="qrEndereco"></div>
        ${rede.enderecos.length > 1
          ? `<div class="linhas-toggle" id="qrHosts">${rede.enderecos
              .map((h, i) => `<button type="button" class="pill ${i === 0 ? 'is-on' : ''}" data-host="${esc(h)}">${esc(h)}</button>`)
              .join('')}</div>
             <div class="field-nota">Esta máquina tem mais de um endereço. Se um não abrir, tente o outro.</div>`
          : ''}
        <div class="field-nota">Aponte a câmera do Quest ou do celular. O aparelho precisa estar
          na mesma rede.${rede.esquema === 'https'
            ? ' O certificado é autoassinado: o navegador vai pedir para confirmar antes de abrir.'
            : ' Sem https o modo VR e o giroscópio não ligam — para isso, suba com npm run dev:vr.'}</div>
      </div>
      <div class="painel-pe">
        <div class="dupla"><span></span><button class="btn btn-primary" data-fechar>Fechar</button></div>
      </div>
    </div>`);

  const desenhar = (host) => {
    painel.querySelector('#qrAlvo').innerHTML = qrSvg(url(host), { modulo: 5, silencio: 3 });
    painel.querySelector('#qrEndereco').textContent = url(host);
  };
  desenhar(rede.enderecos[0]);

  painel.querySelector('#qrHosts')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-host]');
    if (!b) return;
    for (const outro of painel.querySelectorAll('[data-host]')) outro.classList.toggle('is-on', outro === b);
    desenhar(b.dataset.host);
  });

  const fechar = () => {
    scrim.remove();
    painel.remove();
    document.removeEventListener('keydown', aoTeclar);
  };
  const aoTeclar = (e) => e.key === 'Escape' && fechar();
  painel.querySelector('[data-fechar]').addEventListener('click', fechar);
  scrim.addEventListener('click', fechar);
  document.addEventListener('keydown', aoTeclar);
  document.body.append(scrim, painel);
  painel.querySelector('[data-fechar]').focus();
}

/** Regera o pacote público sem mexer em publicação. Mesma ação do botão da listagem. */
async function regerarPacote() {
  aviso('Gerando o pacote público…', { ms: 60000 });
  try {
    const r = await api.exportar();
    // Um toast por vez: aviso() derruba o anterior, então os avisos do export vão
    // juntos ou não seriam lidos.
    const extras = (r.avisos || []).join(' ');
    aviso(
      `Pacote público atualizado — ${r.tours} ${r.tours === 1 ? 'obra' : 'obras'}.${extras ? ` ${extras}` : ''}`,
      { ms: extras ? 11000 : 3200 },
    );
  } catch (e) {
    aviso(`Falha ao gerar o pacote: ${e.message}`, { erro: true });
  }
}

window.addEventListener('beforeunload', (e) => {
  if (!sujo) return;
  e.preventDefault();
  e.returnValue = '';
});

// ── panorama ────────────────────────────────────────────────────────────────

function iniciarPano() {
  try {
    pano = criarPanorama(el.tela, {
      aoMover: (cam) => {
        camada?.atualizar();
        el.leitura.hidden = false;
        el.leitura.textContent = formatarVista(cam);
      },
    });
  } catch {
    el.avisoPalco.hidden = false;
    el.avisoPalcoTexto.textContent =
      'Este navegador não expõe WebGL2, necessário para renderizar o panorama. '
      + 'Atualize o navegador ou verifique se a aceleração de hardware está ativa.';
    return false;
  }

  camada = criarCamadaHotspots(el.camadaHs, pano, {
    editavel: true,
    rotuloDestino: nomeCena,
    aoSelecionar: (h) => {
      hsSelId = h.id;
      camada.selecionar(h.id);
      renderInspetor();
    },
    aoMoverHotspot: () => marcarSujo(),
  });

  // Clique no panorama: coloca hotspot quando em modo de colocação; fora dele,
  // desmarca. Arrasto não conta como clique.
  el.tela.addEventListener('click', (e) => {
    if (pano.arrastouPixels > 6) return;
    if (!modo) {
      if (hsSelId) {
        hsSelId = null;
        camada.selecionar(null);
        renderInspetor();
      }
      return;
    }
    const r = el.tela.getBoundingClientRect();
    const { yaw, pitch } = pano.doEcra(e.clientX - r.left, e.clientY - r.top);
    criarHotspot(modo, yaw, pitch);
    sairDoModo();
  });

  return true;
}

async function irParaCena(id, { travessia = false } = {}) {
  const cena = tour.cenas.find((c) => c.id === id);
  if (!cena) return;
  cenaAtualId = id;
  hsSelId = null;
  sairDoModo();

  const caminhos = caminhosDaCena(slug, cena.id);
  el.avisoPalco.hidden = true; // pode estar aberto vindo do estado "nenhum ambiente"
  el.carregando.hidden = false;
  el.carregando.classList.remove('saindo');
  el.barraPalco.hidden = false;

  renderListaCenas();
  renderInspetor();

  try {
    await pano.carregar(
      { previa: caminhos.previa, completa: caminhos.completa },
      cena.vistaInicial,
      { travessia },
    );
    // Clicar rápido entre ambientes aborta o carregamento anterior, mas esta
    // continuação ainda roda: sem a guarda, ela aplicaria os hotspots da cena
    // abandonada por cima da que o editor já está olhando.
    if (cenaAtualId !== id) return;
    camada.definir(cena.hotspots || []);
    el.carregando.classList.add('saindo');
    setTimeout(() => { el.carregando.hidden = true; }, 420);
  } catch (e) {
    el.carregando.hidden = true;
    aviso(`Não foi possível carregar “${cena.nome}”: ${e.message}`, { erro: true });
  }
}

// ── modo de colocação ───────────────────────────────────────────────────────

function entrarNoModo(tipo) {
  modo = tipo;
  el.palco.classList.add('modo-colocar');
  qs('#btAddNav').classList.toggle('is-on', tipo === 'navegacao');
  qs('#btAddInfo').classList.toggle('is-on', tipo === 'info');
  el.dica.hidden = false;
  el.dica.innerHTML =
    tipo === 'navegacao'
      ? `${icone('porta', 14)} Clique onde fica a passagem — a porta, o vão, o início do corredor. <kbd>Esc</kbd> cancela.`
      : `${icone('info', 14)} Clique no detalhe que você quer anotar. <kbd>Esc</kbd> cancela.`;
}

function sairDoModo() {
  modo = null;
  el.palco.classList.remove('modo-colocar');
  qs('#btAddNav')?.classList.remove('is-on');
  qs('#btAddInfo')?.classList.remove('is-on');
  el.dica.hidden = true;
}

function criarHotspot(tipo, yaw, pitch) {
  const cena = cenaAtual();
  if (!cena) return;
  const todos = tour.cenas.flatMap((c) => (c.hotspots || []).map((h) => h.id));
  const h = { id: proximoId('h', todos), tipo, yaw, pitch };
  if (tipo === 'navegacao') {
    // Com dois ambientes o destino é óbvio; sugerir evita um passo de formulário.
    const outra = tour.cenas.find((c) => c.id !== cena.id);
    h.destinoId = tour.cenas.length === 2 && outra ? outra.id : null;
    h.direcao = DIRECAO_PADRAO;
  } else {
    h.titulo = '';
    h.texto = '';
  }
  cena.hotspots = cena.hotspots || [];
  cena.hotspots.push(h);
  hsSelId = h.id;
  camada.definir(cena.hotspots);
  camada.selecionar(h.id);
  marcarSujo();
  renderInspetor();
  setTimeout(() => qs('#campoFoco')?.focus(), 30);
}

function removerHotspot(id) {
  const cena = cenaAtual();
  cena.hotspots = (cena.hotspots || []).filter((h) => h.id !== id);
  if (hsSelId === id) hsSelId = null;
  camada.definir(cena.hotspots);
  marcarSujo();
  renderInspetor();
}

// ── lista de ambientes ──────────────────────────────────────────────────────

function renderListaCenas() {
  const cenas = tour.cenas;
  el.contaCenas.textContent = cenas.length ? `${cenas.length}` : '';
  // A chave de publicação depende de haver ambiente, e é aqui que isso muda.
  renderEstadoPublicacao();

  if (!cenas.length) {
    el.listaCenas.innerHTML =
      `<p class="field-nota" style="padding:10px 7px">Nenhum ambiente ainda. Suba o primeiro panorama abaixo.</p>`;
    return;
  }

  el.listaCenas.innerHTML = cenas
    .map((c) => {
      const nHs = (c.hotspots || []).length;
      return `
      <div class="item-cena ${c.id === cenaAtualId ? 'is-atual' : ''}" data-cena="${esc(c.id)}"
           role="button" tabindex="0" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown">
        <span class="item-thumb"><img src="${esc(caminhosDaCena(slug, c.id).miniatura)}" alt="" loading="lazy"></span>
        <span class="item-texto">
          <span class="item-nome">${esc(c.nome || 'Sem nome')}</span>
          <span class="item-sub">${nHs ? `${nHs} ${nHs === 1 ? 'ponto' : 'pontos'}` : 'sem pontos'}${tour.capaCenaId === c.id ? ' · capa' : ''}</span>
        </span>
        <span class="item-pega" aria-hidden="true" title="Arraste para reordenar — ou Alt + ↑ ↓">${icone('pega', 14)}</span>
      </div>`;
    })
    .join('');
}

// ── inspetor ────────────────────────────────────────────────────────────────

function renderInspetor() {
  const cena = cenaAtual();
  if (!cena) {
    el.inspetor.innerHTML = `
      <div class="insp-secao">
        <div class="eyebrow">INSPETOR</div>
        <p class="body">Suba um panorama para começar. Cada arquivo equirretangular vira um
          ambiente do tour.</p>
      </div>`;
    return;
  }

  const hs = cena.hotspots || [];
  const sel = hs.find((h) => h.id === hsSelId) || null;
  const outras = tour.cenas.filter((c) => c.id !== cena.id);
  const v = cena.vistaInicial || { yaw: 0, pitch: 0, fov: FOV_PADRAO };

  el.inspetor.innerHTML = `
    <div class="insp-secao">
      <div class="insp-cabeca">
        <div class="eyebrow">AMBIENTE</div>
        <span class="meta">${esc(cena.largura || '?')}×${esc(cena.altura || '?')}</span>
      </div>
      <div class="field-group">
        <label class="field-label" for="cNome">Nome</label>
        <input class="field" id="cNome" value="${esc(cena.nome || '')}" maxlength="60"
               placeholder="Fachada oeste">
        <div class="field-nota">É o rótulo que o visitante lê no ponto de passagem e na tira de ambientes.</div>
      </div>
      <div class="field-group">
        <span class="field-label">Vista de entrada</span>
        <div class="meta-s">${esc(formatarVista(v))}</div>
        <div class="field-nota">Enquadre o panorama e use <b>Fixar vista de entrada</b> na barra
          superior para gravar por onde o visitante começa a olhar aqui.</div>
      </div>
      <div style="display:flex;gap:var(--s10);flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="btCapa" ${tour.capaCenaId === cena.id ? 'disabled' : ''}>
          ${tour.capaCenaId === cena.id ? 'É a capa do tour' : 'Usar como capa'}
        </button>
        <button class="btn btn-ghost btn-sm btn-perigo" id="btRemoverCena">Remover ambiente</button>
      </div>
    </div>

    <div class="insp-secao">
      <div class="insp-cabeca">
        <div class="eyebrow">PONTOS NESTE AMBIENTE</div>
        <span class="meta">${hs.length}</span>
      </div>
      ${hs.length
        ? `<div class="lista-hs">${hs.map((h) => linhaHs(h)).join('')}</div>`
        : `<p class="field-nota">Nenhum ponto aqui. Use a barra sobre o panorama para colocar
             uma passagem para outro ambiente ou uma anotação sobre um detalhe.</p>`}
      ${sel ? formaHotspot(sel, outras) : ''}
    </div>`;

  hidratarIcones(el.inspetor);
  ligarInspetor(cena, sel);
}

function linhaHs(h) {
  const nav = h.tipo === 'navegacao';
  const titulo = nav ? nomeCena(h.destinoId) || 'Destino não definido' : h.titulo || 'Sem título';
  const falta = nav ? !h.destinoId : !h.titulo;
  return `
    <button class="hs-linha ${h.id === hsSelId ? 'is-sel' : ''}" data-hs="${esc(h.id)}">
      <span class="hs-linha-icone">${icone(nav ? 'porta' : 'info', 14)}</span>
      <span class="hs-linha-texto">
        <b>${esc(titulo)}</b>
        <span>${nav ? 'Passagem' : 'Informação'}${falta ? ' · incompleto' : ''}</span>
      </span>
      ${icone('direita', 14)}
    </button>`;
}

/**
 * Rosa 3×3 com as oito direções da seta. O miolo não é botão: mostra a seta como ela
 * vai ficar no panorama, para a escolha ser conferida sem tirar os olhos do inspetor.
 */
function rosaDaSeta(atual) {
  const cela = (id) => {
    const d = DIRECOES_SETA.find((x) => x.id === id);
    const on = d.id === (atual || DIRECAO_PADRAO);
    return `
      <button type="button" data-direcao="${d.id}" class="${on ? 'is-on' : ''}"
              aria-pressed="${on}" aria-label="${esc(d.nome)}" title="${esc(d.nome)}"
              style="--giro:${d.graus}deg">${icone('seta', 13, 1.75)}</button>`;
  };
  return `
    <div class="rosa" role="group" aria-label="Direção da seta">
      ${cela('cima-esquerda')}${cela('cima')}${cela('cima-direita')}
      ${cela('esquerda')}
      <span class="rosa-meio" aria-hidden="true"
            style="--giro:${grausDaSeta(atual || DIRECAO_PADRAO)}deg">${icone('seta', 17, 1.75)}</span>
      ${cela('direita')}
      ${cela('baixo-esquerda')}${cela('baixo')}${cela('baixo-direita')}
    </div>`;
}

function formaHotspot(h, outras) {
  const nav = h.tipo === 'navegacao';
  return `
    <div class="forma-hs">
      <div class="insp-cabeca">
        <div class="eyebrow">PONTO SELECIONADO</div>
        <button class="btn-quiet" id="btFecharHs" aria-label="Fechar edição do ponto">${icone('x', 14)}</button>
      </div>

      <div class="seg" role="group" aria-label="Tipo do ponto">
        <button data-tipo="navegacao" class="${nav ? 'is-on' : ''}">Passagem</button>
        <button data-tipo="info" class="${!nav ? 'is-on' : ''}">Informação</button>
      </div>

      ${nav
        ? `<div class="field-group">
             <label class="field-label" for="campoFoco">Leva para</label>
             <select class="field" id="campoFoco" data-campo="destinoId">
               <option value="">Escolha o ambiente…</option>
               ${outras.map((c) => `<option value="${esc(c.id)}" ${h.destinoId === c.id ? 'selected' : ''}>${esc(c.nome || c.id)}</option>`).join('')}
             </select>
             ${outras.length ? '' : '<div class="field-nota">Suba outro ambiente para poder ligar os dois.</div>'}
           </div>
           <div class="field-group">
             <div class="field-label">Para onde a seta aponta</div>
             ${rosaDaSeta(h.direcao)}
             <div class="field-nota">Aponte para onde o ambiente fica na foto — a porta à esquerda, a escada para cima.</div>
           </div>`
        : `<div class="field-group">
             <label class="field-label" for="campoFoco">Título</label>
             <input class="field" id="campoFoco" data-campo="titulo" maxlength="70"
                    value="${esc(h.titulo || '')}" placeholder="Brise Origens 40">
           </div>
           <div class="field-group">
             <label class="field-label" for="hsTexto">Texto</label>
             <textarea class="field" id="hsTexto" data-campo="texto" maxlength="900"
                       placeholder="Ripa de 40 mm em Tasmania Oak, montagem vertical com espaçamento de 30 mm.">${esc(h.texto || '')}</textarea>
             <div class="field-nota">Aparece num painel quando o visitante toca no ponto.</div>
           </div>`}

      <div class="field-nota">Arraste o ponto sobre o panorama para reposicionar.</div>
      <button class="btn btn-ghost btn-sm btn-perigo" id="btRemoverHs">Remover ponto</button>
    </div>`;
}

function ligarInspetor(cena, sel) {
  const nomeInput = qs('#cNome', el.inspetor);
  nomeInput?.addEventListener('input', debounce(() => {
    cena.nome = nomeInput.value;
    marcarSujo();
    renderListaCenas();
    camada.definir(cena.hotspots || []); // rótulo de passagem que aponta para cá muda
  }, 220));

  qs('#btCapa', el.inspetor)?.addEventListener('click', () => {
    tour.capaCenaId = cena.id;
    marcarSujo();
    renderListaCenas();
    renderInspetor();
    aviso(`“${cena.nome}” agora é a capa do tour.`);
  });

  qs('#btRemoverCena', el.inspetor)?.addEventListener('click', () => removerCena(cena.id));

  for (const b of el.inspetor.querySelectorAll('[data-hs]')) {
    b.addEventListener('click', () => {
      hsSelId = b.dataset.hs;
      camada.selecionar(hsSelId);
      const h = (cena.hotspots || []).find((x) => x.id === hsSelId);
      // levar a câmera até o ponto deixa claro qual foi selecionado
      if (h) pano.definirCamera({ yaw: h.yaw, pitch: h.pitch }, { animado: true });
      renderInspetor();
    });
  }

  if (!sel) return;

  qs('#btFecharHs', el.inspetor)?.addEventListener('click', () => {
    hsSelId = null;
    camada.selecionar(null);
    renderInspetor();
  });

  qs('#btRemoverHs', el.inspetor)?.addEventListener('click', () => removerHotspot(sel.id));

  for (const b of el.inspetor.querySelectorAll('[data-tipo]')) {
    b.addEventListener('click', () => {
      const novo = b.dataset.tipo;
      if (novo === sel.tipo) return;
      sel.tipo = novo;
      if (novo === 'navegacao') {
        delete sel.titulo;
        delete sel.texto;
        sel.destinoId = null;
        sel.direcao = sel.direcao || DIRECAO_PADRAO;
      } else {
        delete sel.destinoId;
        delete sel.direcao;
        sel.titulo = '';
        sel.texto = '';
      }
      camada.definir(cena.hotspots);
      marcarSujo();
      renderInspetor();
    });
  }

  // Sem re-render do inspetor: trocar a direção é um ajuste fino, feito várias vezes
  // seguidas, e o foco tem que ficar no botão para dar para percorrer a rosa no teclado.
  const rosa = qs('.rosa', el.inspetor);
  for (const b of rosa?.querySelectorAll('[data-direcao]') || []) {
    b.addEventListener('click', () => {
      sel.direcao = b.dataset.direcao;
      for (const outro of rosa.querySelectorAll('[data-direcao]')) {
        const on = outro === b;
        outro.classList.toggle('is-on', on);
        outro.setAttribute('aria-pressed', String(on));
      }
      rosa.querySelector('.rosa-meio').style.setProperty('--giro', `${grausDaSeta(sel.direcao)}deg`);
      camada.definir(cena.hotspots);
      marcarSujo();
    });
  }

  for (const campo of el.inspetor.querySelectorAll('[data-campo]')) {
    const aplicar = () => {
      sel[campo.dataset.campo] = campo.value;
      marcarSujo();
      camada.definir(cena.hotspots);
      // relista sem perder o foco do campo que está sendo digitado
      for (const linha of el.inspetor.querySelectorAll('[data-hs]')) {
        if (linha.dataset.hs !== sel.id) continue;
        const nav = sel.tipo === 'navegacao';
        const titulo = nav ? nomeCena(sel.destinoId) || 'Destino não definido' : sel.titulo || 'Sem título';
        linha.querySelector('b').textContent = titulo;
      }
    };
    campo.addEventListener(campo.tagName === 'SELECT' ? 'change' : 'input', debounce(aplicar, 200));
  }
}

async function removerCena(id) {
  const cena = tour.cenas.find((c) => c.id === id);
  const apontam = tour.cenas
    .flatMap((c) => (c.hotspots || []).filter((h) => h.destinoId === id).map(() => c.nome))
    .filter(Boolean);

  const ok = await confirmar({
    titulo: `Remover “${cena.nome}”?`,
    texto: apontam.length
      ? `A imagem e os pontos deste ambiente são apagados. ${apontam.length} `
        + `${apontam.length === 1 ? 'passagem que aponta' : 'passagens que apontam'} para cá `
        + `${apontam.length === 1 ? 'também é removida' : 'também são removidas'}.`
      : 'A imagem e os pontos deste ambiente são apagados. Não há como desfazer.',
    confirmar: 'Remover',
    perigo: true,
  });
  if (!ok) return;

  tour.cenas = tour.cenas.filter((c) => c.id !== id);
  // Passagem órfã viraria um ponto que não leva a lugar nenhum: some junto.
  for (const c of tour.cenas) {
    c.hotspots = (c.hotspots || []).filter((h) => h.destinoId !== id);
  }
  if (tour.capaCenaId === id) tour.capaCenaId = tour.cenas[0]?.id || null;

  try {
    await api.removerMidia(slug, id);
  } catch {
    /* o JSON é a fonte de verdade; arquivo remanescente não quebra o tour */
  }
  await salvar({ silencioso: true });

  if (tour.cenas.length) {
    await irParaCena(tour.cenas[0].id);
  } else {
    cenaAtualId = null;
    camada.definir([]);
    el.barraPalco.hidden = true;
    el.leitura.hidden = true;
    renderListaCenas();
    renderInspetor();
  }
  renderManutencao();
  aviso('Ambiente removido.');
}

// ── upload ──────────────────────────────────────────────────────────────────

async function subirArquivos(arquivos) {
  const lista = [...arquivos].filter((f) => f.type.startsWith('image/'));
  if (!lista.length) return;

  for (const arquivo of lista) {
    const cartao = no(`
      <div class="upload-item">
        <span class="upload-nome">${esc(arquivo.name)}</span>
        <span class="upload-etapa">na fila</span>
        <span class="progresso"><i style="width:8%"></i></span>
      </div>`);
    el.filaUpload.appendChild(cartao);
    const etapa = cartao.querySelector('.upload-etapa');
    const barra = cartao.querySelector('.progresso i');

    try {
      let feitas = 0;
      const prep = await prepararPanorama(arquivo, (nome) => {
        etapa.textContent = nome;
        feitas += 1;
        barra.style.width = `${8 + feitas * 13}%`;
      });

      if (!prep.proporcaoOk) {
        aviso(
          `“${arquivo.name}” está em ${prep.proporcao.toFixed(2)}:1 — panorama equirretangular é 2:1. `
          + 'A imagem foi aceita, mas a projeção pode distorcer.',
          { ms: 7000 },
        );
      }

      // A promessa do editor é guardar a original intacta. Quando ela não pode ser
      // cumprida o motivo tem que aparecer na hora: descobrir depois, olhando um
      // panorama macio no headset na frente do cliente, é tarde.
      if (prep.recomprimida) {
        aviso(
          `“${arquivo.name}” foi recomprimido: `
          + (arquivo.size > LIMITE_UPLOAD
            ? `${formatarBytes(arquivo.size)} passa do limite de ${formatarBytes(LIMITE_UPLOAD)}.`
            : 'só JPEG vai sem recompressão; PNG é reencodado.'),
          { ms: 7000 },
        );
      }

      const id = proximoId('c', tour.cenas.map((c) => c.id));
      const nomes = nomesDeArquivo(id);
      etapa.textContent = 'Enviando';
      barra.style.width = '80%';
      await api.enviarMidia(slug, nomes.completa, prep.completa.blob);
      if (prep.media) await api.enviarMidia(slug, nomes.media, prep.media.blob);
      await api.enviarMidia(slug, nomes.previa, prep.previa.blob);
      await api.enviarMidia(slug, nomes.miniatura, prep.miniatura.blob);

      tour.cenas.push({
        id,
        nome: nomeSugerido(arquivo.name, tour.cenas.length),
        largura: prep.largura,
        altura: prep.altura,
        // Panorama que já nasce pequeno não ganha derivada de tela — não haveria o
        // que reduzir. O campo ausente ou falso manda o tour usar a completa.
        temMedia: !!prep.media,
        // Entrada em yaw 0 até o editor fixar outra: previsível, nunca "onde eu
        // tinha parado de olhar".
        vistaInicial: { yaw: 0, pitch: 0, fov: FOV_PADRAO },
        hotspots: [],
      });
      if (!tour.capaCenaId) tour.capaCenaId = id;

      // A mídia já está em disco: gravar o JSON agora evita imagem órfã se a aba fechar.
      await salvar({ silencioso: true });
      barra.style.width = '100%';
      etapa.textContent = 'pronto';
      renderListaCenas();
      renderManutencao();
      if (!cenaAtualId) await irParaCena(id);
      setTimeout(() => cartao.remove(), 900);
    } catch (e) {
      etapa.textContent = e.message;
      cartao.style.boxShadow = 'inset 0 0 0 1px #b06a5c';
      aviso(`Falha em “${arquivo.name}”: ${e.message}`, { erro: true });
    }
  }
}

// ── derivada de tela das cenas antigas ──────────────────────────────────────

/**
 * Cenas que nunca passaram pela derivada de tela.
 *
 * `temMedia` é tri-estado de propósito: ausente é "nunca processada", `true` é "o
 * arquivo está em disco", `false` é "processada e não há o que reduzir". Sem o
 * terceiro estado um panorama pequeno voltaria para esta fila em toda abertura do
 * editor, e a única forma de tirá-lo dali seria mentir sobre a largura dele.
 *
 * A largura vem do JSON e evita baixar 20 MB para descobrir que não havia o que fazer.
 */
const semDerivadaDeTela = () =>
  (tour?.cenas || []).filter(
    (c) => c.temMedia === undefined && (c.largura || Infinity) > LARGURA_MEDIA,
  );

/**
 * O custo desta pendência é invisível de dentro do editor: aqui é desktop em rede
 * local, e a conta de 23 MB por ambiente só aparece no celular de quem recebeu o
 * link. Por isso ela é dita em voz alta, e não deixada para o export descobrir.
 */
function renderManutencao() {
  const pendentes = semDerivadaDeTela();
  el.manutencao.hidden = !pendentes.length;
  if (!pendentes.length) return;

  const n = pendentes.length;
  el.manutencao.innerHTML = `
    <b>${n} ${n === 1 ? 'ambiente sem' : 'ambientes sem'} imagem de tela</b>
    <p>No celular o visitante baixa o panorama inteiro. A derivada de ${LARGURA_MEDIA} px
      corta isso para cerca de um décimo, sem tocar na foto original.</p>
    <button class="btn btn-secondary btn-sm" data-regerar>Gerar imagens de tela</button>`;
  el.manutencao.querySelector('[data-regerar]').addEventListener('click', regerarDerivadas);
}

/**
 * Backfill: gera a derivada de tela das cenas que só têm a completa.
 *
 * Uma de cada vez, e não em Promise.all: cada passo decodifica um panorama de
 * 8192 px, que são ~134 MB de RGBA vivos. Três em paralelo derrubariam a aba, e a
 * espera aqui não tem ninguém olhando com pressa.
 */
async function regerarDerivadas() {
  const pendentes = semDerivadaDeTela();
  if (!pendentes.length) return;

  const bt = el.manutencao.querySelector('[data-regerar]');
  if (bt) {
    bt.disabled = true;
    bt.textContent = 'Gerando…';
  }

  let falhas = 0;
  for (const cena of pendentes) {
    const cartao = no(`
      <div class="upload-item">
        <span class="upload-nome">${esc(cena.nome || cena.id)}</span>
        <span class="upload-etapa">baixando</span>
        <span class="progresso"><i style="width:10%"></i></span>
      </div>`);
    el.filaUpload.appendChild(cartao);
    const etapa = cartao.querySelector('.upload-etapa');
    const barra = cartao.querySelector('.progresso i');

    try {
      const resposta = await fetch(caminhosDaCena(slug, cena.id).completa);
      if (!resposta.ok) throw new Error(`panorama indisponível (${resposta.status})`);

      etapa.textContent = 'reduzindo';
      barra.style.width = '45%';
      const media = await prepararMedia(await resposta.blob());

      if (media) {
        etapa.textContent = 'enviando';
        barra.style.width = '80%';
        await api.enviarMidia(slug, nomesDeArquivo(cena.id).media, media.blob);
      }
      cena.temMedia = !!media;

      barra.style.width = '100%';
      etapa.textContent = media ? formatarBytes(media.blob.size) : 'já era pequena';
      setTimeout(() => cartao.remove(), 900);
    } catch (e) {
      falhas += 1;
      etapa.textContent = e.message;
      cartao.style.boxShadow = 'inset 0 0 0 1px #b06a5c';
    }
  }

  // Grava mesmo com falha no meio: o que deu certo não deve ser refeito depois.
  await salvar({ silencioso: true });
  renderManutencao();
  aviso(
    falhas
      ? `${pendentes.length - falhas} de ${pendentes.length} gerados; ${falhas} falharam.`
      : 'Imagens de tela geradas. Regere o pacote público para publicá-las.',
    { erro: !!falhas, ms: 6000 },
  );
}

/** "DCIM_R0010234.JPG" não diz nada; um rótulo ordinal é mais útil que o nome do arquivo. */
function nomeSugerido(nomeArquivo, indice) {
  const limpo = nomeArquivo
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  const parecePadraoDeCamera = /^(dcim|img|r00|gs|pano|insp?|_)/i.test(limpo) || /^\d+$/.test(limpo);
  return parecePadraoDeCamera || limpo.length < 3 ? `Ambiente ${indice + 1}` : limpo.slice(0, 60);
}

el.arquivos.addEventListener('change', () => {
  subirArquivos(el.arquivos.files);
  el.arquivos.value = '';
});

for (const evento of ['dragenter', 'dragover']) {
  el.solta.addEventListener(evento, (e) => {
    e.preventDefault();
    el.solta.classList.add('is-sobre');
  });
}
for (const evento of ['dragleave', 'dragend']) {
  el.solta.addEventListener(evento, () => el.solta.classList.remove('is-sobre'));
}
el.solta.addEventListener('drop', (e) => {
  e.preventDefault();
  el.solta.classList.remove('is-sobre');
  subirArquivos(e.dataTransfer.files);
});
// O navegador abriria a imagem solta fora da zona, descartando o editor sem salvar.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ── ficha da obra ───────────────────────────────────────────────────────────

function abrirFicha() {
  const scrim = no('<div class="scrim"></div>');
  const painel = no(`
    <form class="painel" role="dialog" aria-modal="true" aria-label="Ficha da obra">
      <div class="painel-topo">
        <div>
          <div class="eyebrow">FICHA DA OBRA</div>
          <h2 class="h3" style="margin-top:5px">${esc(tour.obra)}</h2>
        </div>
      </div>
      <div class="painel-corpo">
        <div class="field-group">
          <label class="field-label" for="fObra">Nome da obra</label>
          <input class="field" id="fObra" name="obra" value="${esc(tour.obra)}" maxlength="90" required>
        </div>
        <div class="field-dupla">
          <div class="field-group">
            <label class="field-label" for="fCidade">Cidade</label>
            <input class="field" id="fCidade" name="cidade" value="${esc(tour.cidade)}" maxlength="60">
          </div>
          <div class="field-group">
            <label class="field-label" for="fUf">UF</label>
            <select class="field" id="fUf" name="uf">
              <option value="">—</option>
              ${UFS.map((u) => `<option value="${u}" ${tour.uf === u ? 'selected' : ''}>${u}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field-dupla">
          <div class="field-group">
            <label class="field-label" for="fTipo">Tipo</label>
            <select class="field" id="fTipo" name="tipo">
              ${TIPOS_OBRA.map((t) => `<option value="${t.id}" ${tour.tipo === t.id ? 'selected' : ''}>${t.nome}</option>`).join('')}
            </select>
          </div>
          <div class="field-group">
            <label class="field-label" for="fAno">Ano de entrega</label>
            <input class="field" id="fAno" name="ano" type="number" min="1990" max="2100" value="${esc(tour.ano || '')}">
          </div>
        </div>
        <div class="field-group">
          <label class="field-label" for="fEscritorio">Arquiteto ou escritório</label>
          <input class="field" id="fEscritorio" name="escritorio" value="${esc(tour.escritorio)}" maxlength="90">
        </div>
        <div class="field-group">
          <span class="field-label">Linhas aplicadas</span>
          <div class="linhas-toggle" id="fLinhas">
            ${LINHAS.map((l) => `<button type="button" class="pill ${tour.linhas.includes(l.id) ? 'is-on' : ''}" data-linha="${l.id}">${l.nome}</button>`).join('')}
          </div>
          <div class="field-nota">Aparecem como etiquetas na capa do acervo e na ficha do tour.</div>
        </div>
        <div class="field-group">
          <label class="field-label" for="fApresentacao">Texto de apresentação</label>
          <textarea class="field" id="fApresentacao" name="apresentacao" maxlength="800"
            placeholder="Onde a luz do dia entra com ritmo e sem agressão.">${esc(tour.apresentacao)}</textarea>
          <div class="field-nota">Abertura da capa do tour, antes de o visitante entrar. Um parágrafo.
            Também vira a descrição do link quando ele circula.</div>
        </div>
        <div class="field-group">
          <span class="field-label">Foto de compartilhamento</span>
          <label class="foto-social">
            <input type="file" id="fFoto" accept="image/jpeg,image/png,image/webp" hidden>
            <span class="foto-social-previa"><img id="fFotoImg" alt="" hidden></span>
            <span class="foto-social-texto">
              <b id="fFotoRotulo">Escolher foto…</b>
              <span id="fFotoNota">A miniatura que o WhatsApp e o e-mail mostram. Foto do
                empreendimento, não panorama — recortada em ${LARGURA_COMPARTILHAR}×${ALTURA_COMPARTILHAR}.</span>
            </span>
          </label>
          <button type="button" class="btn-quiet" data-remover-foto hidden>Remover foto</button>
        </div>
      </div>
      <div class="painel-pe">
        <div class="dupla">
          <button type="button" class="btn btn-secondary" data-cancelar>Cancelar</button>
          <button type="submit" class="btn btn-primary">Aplicar</button>
        </div>
        <div class="field-nota">O endereço público continua <code>/${esc(slug)}</code> mesmo se o nome mudar.</div>
      </div>
    </form>`);

  const fechar = () => {
    scrim.remove();
    painel.remove();
    document.removeEventListener('keydown', aoTeclar);
  };
  const aoTeclar = (e) => e.key === 'Escape' && fechar();

  const selecionadas = new Set(tour.linhas);
  painel.querySelector('#fLinhas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-linha]');
    if (!b) return;
    const id = b.dataset.linha;
    if (selecionadas.has(id)) selecionadas.delete(id);
    else selecionadas.add(id);
    b.classList.toggle('is-on');
  });

  ligarFotoSocial(painel);

  painel.querySelector('[data-cancelar]').addEventListener('click', fechar);
  scrim.addEventListener('click', fechar);
  document.addEventListener('keydown', aoTeclar);

  painel.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(painel));
    Object.assign(tour, {
      obra: dados.obra.trim() || tour.obra,
      cidade: dados.cidade.trim(),
      uf: dados.uf,
      tipo: dados.tipo,
      ano: Number(dados.ano) || null,
      escritorio: dados.escritorio.trim(),
      apresentacao: dados.apresentacao.trim(),
      linhas: LINHAS.map((l) => l.id).filter((id) => selecionadas.has(id)),
    });
    marcarSujo();
    renderTopo();
    fechar();
    await salvar();
  });

  document.body.append(scrim, painel);
  painel.querySelector('#fObra').focus();
}

/**
 * Foto de compartilhamento da obra.
 *
 * Sobe na hora em que é escolhida, e não no "Aplicar" da ficha: é mídia, e mídia
 * neste editor sempre foi ao disco antes do JSON — assim uma aba fechada no meio não
 * deixa referência sem arquivo. Por isso também não há campo no schema: quem sabe se
 * a foto existe é o disco, e o servidor olha ali na hora de gerar as meta tags.
 */
function ligarFotoSocial(painel) {
  const entrada = painel.querySelector('#fFoto');
  const img = painel.querySelector('#fFotoImg');
  const rotulo = painel.querySelector('#fFotoRotulo');
  const nota = painel.querySelector('#fFotoNota');
  const btRemover = painel.querySelector('[data-remover-foto]');

  const mostrar = (existe) => {
    img.hidden = !existe;
    btRemover.hidden = !existe;
    rotulo.textContent = existe ? 'Trocar foto…' : 'Escolher foto…';
  };

  // Sem campo no schema, a única forma de saber é pedir o arquivo. O parâmetro de
  // versão evita o cache mostrar a foto anterior logo depois de uma troca.
  img.addEventListener('load', () => mostrar(true));
  img.addEventListener('error', () => mostrar(false));
  img.src = `${caminhoCompartilhar(slug)}?v=${Date.now()}`;

  entrada.addEventListener('change', async () => {
    const arquivo = entrada.files?.[0];
    entrada.value = '';
    if (!arquivo) return;

    rotulo.textContent = 'Processando…';
    try {
      const prep = await prepararCompartilhar(arquivo);
      await api.enviarMidia(slug, ARQUIVO_COMPARTILHAR, prep.blob);
      img.src = `${caminhoCompartilhar(slug)}?v=${Date.now()}`;
      nota.textContent = `${formatarBytes(prep.blob.size)} · ${prep.largura}×${prep.altura}. `
        + 'Regere o pacote público para o link passar a mostrá-la.';
      if (prep.pequena) {
        aviso(
          `“${arquivo.name}” é menor que ${LARGURA_COMPARTILHAR}×${ALTURA_COMPARTILHAR} e foi ampliada. `
          + 'O link vai circular com a miniatura borrada — vale procurar o arquivo original.',
          { ms: 7000 },
        );
      }
    } catch (e) {
      mostrar(!img.hidden);
      aviso(`Falha ao subir a foto: ${e.message}`, { erro: true });
    }
  });

  btRemover.addEventListener('click', async () => {
    try {
      await api.removerCompartilhar(slug);
      img.removeAttribute('src');
      mostrar(false);
      nota.textContent = 'Sem foto: o link vai levar a prévia equirretangular da capa, '
        + 'que sai com o teto e o piso esticados.';
    } catch (e) {
      aviso(`Não foi possível remover: ${e.message}`, { erro: true });
    }
  });
}

// ── topo ────────────────────────────────────────────────────────────────────

function renderTopo() {
  el.obraNome.textContent = tour.obra;
  el.obraEyebrow.textContent = [nomeTipo(tour.tipo), tour.cidade, tour.ano].filter(Boolean).join(' · ').toUpperCase();
  el.btVer.href = `/tour?t=${slug}`;
  document.title = `${tour.obra} — Lesco Viewer`;
  renderEstadoPublicacao();
}

/**
 * Estado da chave de publicação.
 *
 * Tour sem ambiente não pode ser publicado, e antes esse impedimento só aparecia DEPOIS
 * de tentar, num toast que desaparecia: a chave voltava sozinha para Rascunho e a
 * explicação sumia antes de ser lida. Parecia que publicar estava quebrado. Agora a
 * chave já vem desligada com o motivo escrito ao lado, antes da tentativa.
 */
let publicando = false;

function renderEstadoPublicacao() {
  if (!tour) return;
  const vazio = !tour.cenas?.length;
  el.swPublicado.disabled = vazio || publicando;
  el.swPublicado.checked = !!tour.publicado;
  el.rotuloPublicado.textContent = publicando
    ? 'Publicando…'
    : vazio
      ? 'Suba um ambiente para poder publicar'
      : tour.publicado ? 'Publicado' : 'Rascunho';
  el.rotuloPublicado.classList.toggle('rotulo-impedido', vazio && !publicando);
}

/**
 * Publicar tem que publicar.
 *
 * Antes isto só marcava uma bandeira e mandava você gerar o pacote noutra tela — dois
 * passos em lugares diferentes, e o segundo fácil de nunca acontecer. O resultado é que
 * o tour ficava eternamente fora do acervo mesmo marcado como publicado. Agora a mesma
 * ação grava e regera o pacote.
 */
el.swPublicado.addEventListener('change', async () => {
  tour.publicado = el.swPublicado.checked;
  publicando = true;
  renderEstadoPublicacao();

  try {
    await salvar({ silencioso: true });
    const r = await api.exportar();
    const obras = `${r.tours} ${r.tours === 1 ? 'obra' : 'obras'}`;
    aviso(tour.publicado
      ? `Publicado. Pacote regerado com ${obras} no acervo.`
      : `Voltou a rascunho. Pacote regerado com ${obras} no acervo.`);
  } catch (e) {
    aviso(`Estado salvo, mas o pacote não foi regerado: ${e.message}`, { erro: true });
  } finally {
    publicando = false;
    renderEstadoPublicacao();
  }
});

qs('#btFicha').addEventListener('click', abrirFicha);
el.btSalvar.addEventListener('click', () => salvar());

// ── ordem dos ambientes ─────────────────────────────────────────────────────

/**
 * Reordenar por arrasto, com o DOM como fonte da ordem durante o gesto.
 *
 * O array só é reescrito ao soltar: enquanto o dedo está na tela quem manda é a
 * posição dos nós, o que reduz "passei do meio do vizinho?" a uma comparação de
 * retângulos em vez de aritmética de índice contra uma lista que muda embaixo.
 *
 * Nada no markup do item depende mais da posição — foi o que as setas de subir e
 * descer custavam. Por isso soltar não precisa de renderListaCenas(): a ordem já está
 * certa na tela e as nove miniaturas não piscam a cada troca.
 */
function aplicarOrdemDoDom() {
  const ordem = [...el.listaCenas.querySelectorAll('[data-cena]')].map((n) => n.dataset.cena);
  const antes = tour.cenas.map((c) => c.id).join();
  tour.cenas.sort((a, b) => ordem.indexOf(a.id) - ordem.indexOf(b.id));
  if (tour.cenas.map((c) => c.id).join() !== antes) marcarSujo();
}

/**
 * Move o nó e desliza os vizinhos da posição antiga para a nova (FLIP).
 *
 * Reordenar o DOM é instantâneo e não anima nada sozinho: sem isto a lista pula, e
 * numa coluna de miniaturas iguais o pulo não diz qual linha foi para onde.
 */
function reordenarComDeslize(mover) {
  const nos = [...el.listaCenas.children];
  const antes = new Map(nos.map((n) => [n, n.getBoundingClientRect().top]));
  mover();
  for (const n of nos) {
    if (n.classList.contains('is-arrastando')) continue; // esse segue o ponteiro
    const d = antes.get(n) - n.getBoundingClientRect().top;
    if (!d) continue;
    n.style.transition = 'none';
    n.style.transform = `translateY(${d}px)`;
    requestAnimationFrame(() => {
      n.style.transition = '';
      n.style.transform = '';
    });
  }
}

let arrasteCena = null;
let fimDoArrasto = 0;
const rolagem = { v: 0, raf: 0, y: 0 };

/** Recoloca o item sob o ponteiro e, se passou do meio de um vizinho, troca de lugar. */
function posicionarArraste(clientY) {
  const { item, pegouEm } = arrasteCena;
  item.style.transform = 'none'; // medir a posição real, sem o deslocamento do arrasto
  const alvo = [...el.listaCenas.querySelectorAll('[data-cena]')]
    .filter((n) => n !== item)
    .find((n) => {
      const r = n.getBoundingClientRect();
      return clientY < r.top + r.height / 2;
    });
  if ((alvo || null) !== (item.nextElementSibling || null)) {
    reordenarComDeslize(() => el.listaCenas.insertBefore(item, alvo || null));
  }
  item.style.transform = `translateY(${clientY - pegouEm - item.getBoundingClientRect().top}px)`;
}

/**
 * Rola a coluna quando o arrasto encosta na borda. Um tour de dezesseis ambientes não
 * cabe na tela, e sem isto mover o último para o topo seria impossível.
 *
 * Precisa de rAF próprio: parado na borda o ponteiro não emite mais pointermove.
 */
function autoRolar(clientY) {
  const r = el.listaCenas.getBoundingClientRect();
  const zona = 34;
  rolagem.y = clientY;
  rolagem.v = clientY < r.top + zona
    ? -Math.min(14, Math.ceil((r.top + zona - clientY) / 3))
    : clientY > r.bottom - zona
      ? Math.min(14, Math.ceil((clientY - r.bottom + zona) / 3))
      : 0;
  if (!rolagem.v || rolagem.raf) return;
  const passo = () => {
    if (!arrasteCena?.ativo || !rolagem.v) {
      rolagem.raf = 0;
      return;
    }
    const antes = el.listaCenas.scrollTop;
    el.listaCenas.scrollTop += rolagem.v;
    if (el.listaCenas.scrollTop !== antes) posicionarArraste(rolagem.y);
    rolagem.raf = requestAnimationFrame(passo);
  };
  rolagem.raf = requestAnimationFrame(passo);
}

el.listaCenas.addEventListener('pointerdown', (e) => {
  if (e.button) return; // só o botão principal
  // Só a pega arrasta. A linha inteira é o "abrir ambiente" — é o que o cursor promete
  // em cada metade —, e no toque manter o corpo livre é o que deixa a lista rolar.
  if (!e.target.closest('.item-pega')) return;
  const item = e.target.closest('[data-cena]');
  if (!item) return;
  arrasteCena = {
    item,
    id: e.pointerId,
    y0: e.clientY,
    pegouEm: e.clientY - item.getBoundingClientRect().top,
    andou: 0,
    ativo: false,
  };
});

el.listaCenas.addEventListener('pointermove', (e) => {
  const a = arrasteCena;
  if (!a || e.pointerId !== a.id) return;
  a.andou = Math.max(a.andou, Math.abs(e.clientY - a.y0));
  if (a.andou < 4) return; // mão tremida ao clicar não conta como arrasto

  if (!a.ativo) {
    a.ativo = true;
    // Só capturo depois do limiar: capturar no pointerdown desviaria o click de
    // seleção do alvo original e quebraria a troca de ambiente.
    el.listaCenas.setPointerCapture(e.pointerId);
    a.item.classList.add('is-arrastando');
    el.listaCenas.classList.add('esta-reordenando');
  }
  posicionarArraste(e.clientY);
  autoRolar(e.clientY);
});

const encerrarArrasteCena = (e) => {
  const a = arrasteCena;
  if (!a || e.pointerId !== a.id) return;
  arrasteCena = null;
  rolagem.v = 0;
  if (!a.ativo) return;
  a.item.style.transform = '';
  a.item.classList.remove('is-arrastando');
  el.listaCenas.classList.remove('esta-reordenando');
  fimDoArrasto = e.timeStamp;
  aplicarOrdemDoDom();
};
el.listaCenas.addEventListener('pointerup', encerrarArrasteCena);
el.listaCenas.addEventListener('pointercancel', encerrarArrasteCena);

el.listaCenas.addEventListener('click', (e) => {
  // O click que fecha um arrasto trocaria de ambiente sem ninguém ter pedido — e
  // trocar de ambiente custa o carregamento de um panorama inteiro.
  if (e.timeStamp - fimDoArrasto < 250) return;
  const item = e.target.closest('[data-cena]');
  if (item && item.dataset.cena !== cenaAtualId) irParaCena(item.dataset.cena);
});

el.listaCenas.addEventListener('keydown', (e) => {
  const item = e.target.closest('[data-cena]');
  if (!item) return;

  // Alt + setas mantém a reordenação no teclado, que era o que os chevrons davam.
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    const acima = e.key === 'ArrowUp';
    const irmao = acima ? item.previousElementSibling : item.nextElementSibling;
    if (!irmao) return;
    e.preventDefault();
    reordenarComDeslize(() => {
      if (acima) el.listaCenas.insertBefore(item, irmao);
      else el.listaCenas.insertBefore(irmao, item);
    });
    aplicarOrdemDoDom();
    // Reinserir o nó tira o foco dele: sem devolver, só o primeiro Alt+seta funciona.
    item.focus({ preventScroll: true });
    item.scrollIntoView({ block: 'nearest' });
    return;
  }

  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  if (item.dataset.cena !== cenaAtualId) irParaCena(item.dataset.cena);
});

qs('#btAddNav').addEventListener('click', () => {
  if (tour.cenas.length < 2) {
    aviso('Uma passagem precisa de outro ambiente para levar. Suba pelo menos dois.', { erro: true });
    return;
  }
  modo === 'navegacao' ? sairDoModo() : entrarNoModo('navegacao');
});
qs('#btAddInfo').addEventListener('click', () => {
  modo === 'info' ? sairDoModo() : entrarNoModo('info');
});
qs('#btGravarVista').addEventListener('click', () => {
  const cena = cenaAtual();
  if (!cena) return;
  cena.vistaInicial = pano.camera;
  marcarSujo();
  renderInspetor();
  aviso(`Vista de entrada de “${cena.nome}” fixada no enquadramento atual.`);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modo) sairDoModo();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    salvar();
  }
});

// ── entrada ─────────────────────────────────────────────────────────────────

async function iniciar() {
  hidratarIcones();
  if (!slug) {
    location.replace('/gestao');
    return;
  }
  try {
    tour = await api.lerTour(slug);
  } catch (e) {
    el.avisoPalco.hidden = false;
    el.avisoPalcoTexto.textContent = e.message;
    el.obraEyebrow.textContent = 'ERRO';
    return;
  }

  tour.linhas = tour.linhas || [];
  tour.cenas = tour.cenas || [];
  renderTopo();
  renderListaCenas();
  renderManutencao();
  renderInspetor();

  // O QR só faz sentido com o servidor exposto na rede: em 127.0.0.1 ele levaria o
  // headset ao próprio headset. Falha na sondagem apenas mantém o botão escondido.
  api.rede()
    .then((r) => {
      if (!r.rede || !r.enderecos.length) return;
      el.btQr.hidden = false;
      el.btQr.addEventListener('click', abrirQr);
    })
    .catch(() => {});

  if (!iniciarPano()) return;

  if (tour.cenas.length) {
    await irParaCena(tour.capaCenaId && tour.cenas.some((c) => c.id === tour.capaCenaId)
      ? tour.capaCenaId
      : tour.cenas[0].id);
  } else {
    el.avisoPalco.hidden = false;
    el.avisoPalcoTexto.textContent =
      'Nenhum ambiente ainda. Suba os panoramas equirretangulares na coluna à esquerda — '
      + 'um arquivo por ambiente da obra.';
  }
}

iniciar();
