/**
 * Tour público.
 *
 * Lê o tour.json estático e nunca conversa com a API do editor — é isso que permite
 * a mesma página funcionar servida pelo servidor de desenvolvimento e como pasta
 * estática na Vercel.
 */

import { criarPanorama, FOV_MIN, FOV_MAX } from './panorama.js';
import { criarCamadaHotspots } from './hotspots.js';
import { criarVR, suportaVR } from './vr.js';
import { icone, hidratarIcones } from './icones.js';
import { esc, qs, no, nomeTipo, local, LINHAS, aviso, debounce } from './comum.js';

/** Por que o giroscópio não ligou, em linguagem de visitante. */
const MOTIVO_GYRO = {
  inseguro:
    'O giroscópio exige conexão segura (https). Por aqui o resto do tour funciona: '
    + 'arraste com o dedo para olhar em volta.',
  negado:
    'Permissão de movimento negada. No iPhone, libere em Ajustes › Safari › '
    + 'Movimento e orientação.',
  inexistente: 'Este aparelho não informa a orientação.',
  'sem-sinal': 'Este aparelho não respondeu com dados de orientação.',
};

/**
 * No pacote exportado o slug está fixado no HTML e a pasta é a própria rota. Em
 * desenvolvimento vem da query. A ordem importa: o valor fixado manda.
 */
const slug = window.__TOUR_SLUG__
  || new URLSearchParams(location.search).get('t')
  || location.pathname.split('/').filter(Boolean).pop();

const el = {
  palco: qs('#palco'),
  tela: qs('#tela'),
  camadaHs: qs('#camadaHs'),
  topo: qs('#tourTopo'),
  obra: qs('#tourObra'),
  local: qs('#tourLocal'),
  tira: qs('#tira'),
  ctrlZoom: qs('#ctrlZoom'),
  carregando: qs('#carregando'),
  avisoPalco: qs('#avisoPalco'),
  avisoPalcoTexto: qs('#avisoPalcoTexto'),
  btGyro: qs('#btGyro'),
  btVR: qs('#btVR'),
  btCopiar: qs('#btCopiar'),
  btTelaCheia: qs('#btTelaCheia'),
};

let tour = null;
let cenaAtualId = null;
let pano = null;
let camada = null;
let painelAberto = null;
let vr = null;

const cenaPor = (id) => tour?.cenas.find((c) => c.id === id) || null;
const nomeCena = (id) => cenaPor(id)?.nome || '';
const caminho = (id, sufixo) => `/media/${slug}/${id}${sufixo}`;

function falhar(mensagem) {
  el.carregando.hidden = true;
  el.avisoPalco.hidden = false;
  el.avisoPalcoTexto.textContent = mensagem;
}

// ── painéis ─────────────────────────────────────────────────────────────────

function fecharPainel() {
  painelAberto?.remove();
  painelAberto = null;
}

function abrirPainel({ eyebrow, titulo, corpo }) {
  fecharPainel();
  const painel = no(`
    <aside class="painel-foto" role="dialog" aria-modal="false" aria-label="${esc(titulo)}">
      <div class="painel-foto-topo">
        <div>
          <div class="eyebrow">${esc(eyebrow)}</div>
          <h2>${esc(titulo)}</h2>
        </div>
        <button class="painel-foto-fechar" aria-label="Fechar">${icone('x', 18)}</button>
      </div>
      <div class="painel-foto-corpo">${corpo}</div>
    </aside>`);
  painel.querySelector('.painel-foto-fechar').addEventListener('click', fecharPainel);
  el.palco.appendChild(painel);
  painelAberto = painel;
  painel.querySelector('.painel-foto-fechar').focus();
}

function abrirInfo(h) {
  abrirPainel({
    eyebrow: 'DETALHE',
    titulo: h.titulo || 'Informação',
    corpo: h.texto
      ? `<div class="regua-marca"></div><p>${esc(h.texto).replace(/\n+/g, '</p><p>')}</p>`
      : '<div class="regua-marca"></div>',
  });
}

function abrirFicha() {
  const pares = [
    ['Local', local(tour.cidade, tour.uf)],
    ['Tipo', nomeTipo(tour.tipo)],
    ['Ano de entrega', tour.ano],
    ['Arquitetura', tour.escritorio],
    ['Ambientes', tour.cenas.length],
  ].filter(([, v]) => v);

  abrirPainel({
    eyebrow: 'FICHA DA OBRA',
    titulo: tour.obra,
    corpo: `
      <div class="regua-marca"></div>
      ${tour.apresentacao ? `<p>${esc(tour.apresentacao)}</p>` : ''}
      <div class="painel-foto-ficha">
        ${pares.map(([r, v]) => `<div class="par"><span class="rot">${esc(r)}</span><span class="val">${esc(v)}</span></div>`).join('')}
        ${tour.linhas.length
          ? `<div class="par"><span class="rot">Linhas aplicadas</span>
               <span class="capa-tags" style="margin-top:4px">${tour.linhas.map((id) => `<span class="tag-foto">${esc(LINHAS.find((l) => l.id === id)?.nome || id)}</span>`).join('')}</span></div>`
          : ''}
      </div>`,
  });
}

// ── capa ────────────────────────────────────────────────────────────────────

/**
 * A capa fica sobre o panorama já carregado, não sobre uma tela morta: quando o
 * visitante entra, o cenário atrás dele é o mesmo que já estava ali.
 */
function montarCapa() {
  const pares = [
    ['Local', local(tour.cidade, tour.uf)],
    ['Ano', tour.ano],
    ['Arquitetura', tour.escritorio],
  ].filter(([, v]) => v);

  const capa = no(`
    <div class="capa" id="capa">
      <div class="capa-conteudo">
        <div class="eyebrow">${esc([nomeTipo(tour.tipo), local(tour.cidade, tour.uf)].filter(Boolean).join(' · '))}</div>
        <h1 class="capa-obra">${esc(tour.obra)}</h1>
        ${tour.apresentacao ? `<p class="capa-apresentacao">${esc(tour.apresentacao)}</p>` : ''}
        ${tour.linhas.length
          ? `<div class="capa-tags">${tour.linhas.map((id) => `<span class="tag-foto">${esc(LINHAS.find((l) => l.id === id)?.nome || id)}</span>`).join('')}</div>`
          : ''}
        ${pares.length
          ? `<div class="capa-ficha">${pares.map(([r, v]) => `<div><span class="rot">${esc(r)}</span><span class="val">${esc(v)}</span></div>`).join('')}</div>`
          : ''}
        <button class="btn-entrar" id="btEntrar">Entrar no tour ${icone('seta', 16)}</button>
      </div>
    </div>`);

  capa.querySelector('#btEntrar').addEventListener('click', () => {
    capa.classList.add('saindo');
    setTimeout(() => capa.remove(), 460);
    revelarChrome();
  });

  el.palco.appendChild(capa);
}

/** Sai da capa e entrega o tour. Também é o caminho de quem chegou por link de vista. */
function revelarChrome() {
  el.topo.hidden = false;
  el.tira.hidden = false;
  el.ctrlZoom.hidden = false;
  el.tela.focus();
}

// ── tira de ambientes ───────────────────────────────────────────────────────

/** Monta a tira uma única vez; a troca de ambiente só move o destaque. */
function montarTira() {
  el.tira.innerHTML = tour.cenas
    .map(
      (c) => `
      <button class="tira-item" data-cena="${esc(c.id)}" aria-current="false">
        <span class="tira-thumb"><img src="${esc(caminho(c.id, '.thumb.jpg'))}" alt="" loading="lazy"></span>
        <span class="tira-nome">${esc(c.nome || 'Ambiente')}</span>
      </button>`,
    )
    .join('');
}

/**
 * Reconstruir a tira por innerHTML a cada travessia descartaria o botão que está
 * com o foco, e quem navega por teclado perderia a posição em toda troca de
 * ambiente. Aqui só o destaque se move.
 */
function destacarNaTira() {
  for (const b of el.tira.querySelectorAll('[data-cena]')) {
    const atual = b.dataset.cena === cenaAtualId;
    b.classList.toggle('is-atual', atual);
    b.setAttribute('aria-current', atual ? 'true' : 'false');
    if (atual) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

el.tira.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cena]');
  if (b && b.dataset.cena !== cenaAtualId) irParaCena(b.dataset.cena);
});

// ── endereço do ambiente e da vista ─────────────────────────────────────────

/**
 * O tour é peça de venda e circula por WhatsApp. Sem isto o representante só
 * consegue mandar "abre o tour e procura"; com isto ele manda o brise, no
 * enquadramento em que o brise aparece.
 *
 *   #c5                    o ambiente, na vista de entrada dele
 *   #c5@-2.995,-0.185,54.0 o ambiente e o enquadramento exato
 *
 * Três casas em radianos são 0,06° — abaixo do que o olho separa, e acima disso o
 * link só fica ilegível. A abertura vai em graus, com uma casa, pela mesma razão.
 */
function lerHash() {
  const bruto = decodeURIComponent(location.hash.slice(1) || '').trim();
  if (!bruto) return null;

  const [id, enquadramento] = bruto.split('@');
  // Cena que não existe mais — link antigo, tour reeditado — abre a capa em
  // silêncio. Erro na tela do visitante não conserta nada e estraga a impressão.
  if (!cenaPor(id)) return null;
  if (!enquadramento) return { id, vista: null };

  const n = enquadramento.split(',').map(Number);
  if (n.length !== 3 || n.some((v) => !Number.isFinite(v))) return { id, vista: null };
  // Fora de faixa é limitado, não recusado: número estranho ainda leva ao ambiente
  // certo. Quem faz o corte de pitch e de fov é aplicarVista(), em panorama.js.
  return { id, vista: { yaw: n[0], pitch: n[1], fov: Math.min(Math.max(n[2], FOV_MIN), FOV_MAX) } };
}

/**
 * `replaceState` e não `pushState`: o botão voltar do navegador leva de volta ao
 * site de onde a pessoa veio, e não a um histórico de cada ambiente por onde ela
 * passou — que é o que transformaria "voltar" numa armadilha.
 *
 * Precisa de debounce. Durante um arrasto o aoMover dispara a cada quadro, e o
 * Safari recusa mais de 100 replaceState em 30 segundos com um erro em voz alta.
 */
function escreverHash() {
  if (!cenaAtualId || !pano) return;
  const c = pano.camera;
  const novo = `#${cenaAtualId}@${c.yaw.toFixed(3)},${c.pitch.toFixed(3)},${c.fov.toFixed(1)}`;
  if (location.hash !== novo) history.replaceState(null, '', novo);
}
const escreverHashEmBreve = debounce(escreverHash, 400);

/** Área de transferência sem contexto seguro não existe; o caminho antigo ainda serve. */
async function copiarTexto(texto) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* segue para o caminho antigo */
  }
  const campo = document.createElement('textarea');
  campo.value = texto;
  campo.setAttribute('readonly', '');
  campo.style.cssText = 'position:fixed;top:-9999px;opacity:0';
  document.body.appendChild(campo);
  campo.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  campo.remove();
  return ok;
}

// ── travessia ───────────────────────────────────────────────────────────────

/**
 * Caminhos das derivadas de uma cena.
 *
 * `media` só entra quando existe em disco. Tour anterior à derivada não tem o campo,
 * cai em undefined, e panorama.js usa a completa — fallback, não migração.
 */
function fontesDaCena(id) {
  const fontes = { previa: caminho(id, '.preview.jpg'), completa: caminho(id, '.jpg') };
  if (cenaPor(id)?.temMedia) fontes.media = caminho(id, '.media.jpg');
  return fontes;
}

/**
 * Manda o renderer adiantar os vizinhos desta cena.
 *
 * Sem repetição: dois pontos de passagem podem levar ao mesmo ambiente, e baixar o
 * mesmo arquivo duas vezes não adianta nada. Passagem sem destino fica de fora — é o
 * ponto que não leva a lugar nenhum, e adiantar o nada não ajuda.
 */
function preCarregarVizinhos(cena) {
  const ids = [...new Set(
    (cena.hotspots || [])
      .filter((h) => h.tipo === 'navegacao' && h.destinoId && cenaPor(h.destinoId))
      .map((h) => h.destinoId),
  )];
  pano.preCarregar(ids.map(fontesDaCena));
}

let carregandoCena = false;

async function irParaCena(id, { primeira = false, vista = null, deHotspot = null } = {}) {
  const cena = cenaPor(id);
  if (!cena || carregandoCena) return;
  carregandoCena = true;
  cenaAtualId = id;
  fecharPainel();
  destacarNaTira();

  // Durante a travessia os hotspots da cena anterior não valem mais: escondê-los
  // evita um ponto que aponta para o lugar errado no meio do fade.
  camada?.definir([]);

  try {
    await pano.carregar(fontesDaCena(id), vista || cena.vistaInicial, {
      travessia: !primeira,
      // Só quem entrou por um ponto de passagem tem direção de avanço: pela tira de
      // ambientes não há "para onde", é um salto e se lê melhor como dissolução.
      deHotspot,
    });
    escreverHash();
    camada.definir(cena.hotspots || []);
    // Dentro do headset os pontos são objetos 3D, não os <button> da camada acima:
    // avisar o módulo de VR é o que realinha a cena e remonta os alvos.
    vr?.cenaTrocada();
    preCarregarVizinhos(cena);
    if (primeira) {
      el.carregando.classList.add('saindo');
      setTimeout(() => { el.carregando.hidden = true; }, 440);
    }
  } catch (e) {
    falhar(`Não foi possível carregar este ambiente: ${e.message}`);
  } finally {
    carregandoCena = false;
  }
}

// ── controles ───────────────────────────────────────────────────────────────

qs('#btFicha').addEventListener('click', () => {
  if (painelAberto?.dataset.ficha) fecharPainel();
  else {
    abrirFicha();
    painelAberto.dataset.ficha = '1';
  }
});
qs('#btMaisZoom').addEventListener('click', () => pano.zoom(0.82));
qs('#btMenosZoom').addEventListener('click', () => pano.zoom(1.22));

el.btCopiar.addEventListener('click', async () => {
  escreverHash(); // grava agora, sem esperar os 400 ms do debounce
  const ok = await copiarTexto(location.href);
  aviso(
    ok ? 'Link desta vista copiado.' : `Não foi possível copiar. O endereço é ${location.href}`,
    { erro: !ok, ms: ok ? 2600 : 9000 },
  );
});

/**
 * Endereço colado na barra com o tour já aberto. O replaceState do próprio tour não
 * dispara este evento, então não há laço a temer.
 */
window.addEventListener('hashchange', () => {
  const alvo = lerHash();
  if (!alvo) return;
  if (alvo.id !== cenaAtualId) {
    irParaCena(alvo.id, { vista: alvo.vista });
    return;
  }
  if (alvo.vista) pano.definirCamera(alvo.vista, { animado: true });
});

el.btTelaCheia.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await el.palco.requestFullscreen();
  } catch {
    /* alguns navegadores em iframe recusam; o botão simplesmente não age */
  }
});
document.addEventListener('fullscreenchange', () => {
  const cheia = !!document.fullscreenElement;
  el.btTelaCheia.innerHTML = icone(cheia ? 'recolher' : 'expandir', 16);
  el.btTelaCheia.title = cheia ? 'Sair da tela cheia' : 'Tela cheia';
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') fecharPainel();
});

// ── entrada ─────────────────────────────────────────────────────────────────

(async () => {
  hidratarIcones();

  if (!slug) {
    falhar('Endereço de tour incompleto.');
    return;
  }

  try {
    const resposta = await fetch(`/data/tours/${slug}/tour.json`);
    if (!resposta.ok) throw new Error(`tour não encontrado (${resposta.status})`);
    tour = await resposta.json();
  } catch (e) {
    falhar(`Não foi possível abrir este tour: ${e.message}`);
    return;
  }

  tour.cenas = tour.cenas || [];
  tour.linhas = tour.linhas || [];
  if (!tour.cenas.length) {
    falhar('Este tour ainda não tem ambientes.');
    return;
  }

  document.title = `${tour.obra} — Tour 360 Lesco`;
  el.obra.textContent = tour.obra;
  el.local.textContent = [nomeTipo(tour.tipo), local(tour.cidade, tour.uf), tour.ano]
    .filter(Boolean)
    .join(' · ');

  try {
    pano = criarPanorama(el.tela, {
      aoMover: () => {
        camada?.atualizar();
        escreverHashEmBreve();
      },
    });
  } catch {
    falhar('Este navegador não expõe WebGL2, necessário para exibir o panorama. '
      + 'Atualize o navegador ou verifique se a aceleração de hardware está ativa.');
    return;
  }

  camada = criarCamadaHotspots(el.camadaHs, pano, {
    rotuloDestino: nomeCena,
    aoAcionar: (h) => {
      if (h.tipo === 'navegacao' && h.destinoId) irParaCena(h.destinoId, { deHotspot: h });
      else if (h.tipo === 'info') abrirInfo(h);
    },
  });

  // Giroscópio só aparece onde existe: num desktop o botão seria um engano.
  // Gate so pelo tipo de entrada, e nao pela presenca de DeviceOrientationEvent: fora
  // de contexto seguro o Chrome nem expoe essa interface, e checar por ela aqui faria
  // o botao desaparecer calado justo no caso em que se tem algo a explicar.
  if (matchMedia('(hover: none)').matches) {
    el.btGyro.hidden = false;
    el.btGyro.addEventListener('click', async () => {
      if (pano.temGyro) {
        pano.desligarGyro();
        el.btGyro.classList.remove('is-on');
        el.btGyro.setAttribute('aria-pressed', 'false');
        return;
      }
      const r = await pano.ligarGyro();
      el.btGyro.classList.toggle('is-on', r.ok);
      el.btGyro.setAttribute('aria-pressed', r.ok ? 'true' : 'false');
      if (r.ok) return;

      // Sumir com o botao sem dizer nada deixaria o visitante achando que errou o toque.
      aviso(MOTIVO_GYRO[r.motivo] || 'Nao foi possivel ligar o giroscopio.', { erro: true, ms: 5200 });
      // Falta de sensor e fato do aparelho e nao muda; contexto inseguro e permissao
      // negada tem explicacao que vale poder reler, entao o botao fica.
      if (r.motivo === 'inexistente' || r.motivo === 'sem-sinal') el.btGyro.hidden = true;
    });
  }

  montarTira();

  const alvo = lerHash();
  const primeira = alvo?.id
    || (tour.capaCenaId && cenaPor(tour.capaCenaId) ? tour.capaCenaId : tour.cenas[0].id);
  await irParaCena(primeira, { primeira: true, vista: alvo?.vista || null });

  // Quem clicou num link de ambiente já escolheu. Mostrar a capa depois disso seria
  // pedir um clique a mais para chegar onde a pessoa chegou sozinha.
  if (alvo) revelarChrome();
  else montarCapa();

  // Depois da capa: sondar suporte a VR não deve atrasar a primeira imagem.
  ligarVR();
})();

/**
 * Botão de VR.
 *
 * A regra de exibição repete a lição do giroscópio: fora de contexto seguro o navegador
 * não expõe navigator.xr, então esconder o botão nesse caso o faria desaparecer justo
 * onde há algo a explicar — alguém abrindo pelo headset em http não descobriria nunca
 * o motivo. Só some quando o aparelho de fato não faz VR.
 */
async function ligarVR() {
  const suportado = await suportaVR();

  if (!suportado && window.isSecureContext) return;
  el.btVR.hidden = false;

  el.btVR.addEventListener('click', async () => {
    if (!suportado) {
      aviso(
        window.isSecureContext
          ? 'Este aparelho não oferece modo imersivo.'
          : 'O modo VR exige conexão segura (https). Suba o servidor com npm run dev:vr '
            + 'e abra este endereço pelo navegador do headset.',
        { erro: true, ms: 6000 },
      );
      return;
    }

    el.btVR.disabled = true;
    try {
      vr = vr || criarVR(pano, {
        hotspots: () => cenaPor(cenaAtualId)?.hotspots || [],
        nomeCena,
        aoNavegar: (id) => irParaCena(id),
        aoSair: () => { el.btVR.classList.remove('is-on'); },
      });
      await vr.entrar();
      el.btVR.classList.add('is-on');
    } catch (e) {
      // Recusa de sessão é comum e não é falha do tour: headset ocupado por outro
      // aplicativo, permissão negada, ou nenhum aparelho conectado ao runtime.
      aviso(`Não foi possível abrir o modo VR: ${e.message}`, { erro: true, ms: 6000 });
    } finally {
      el.btVR.disabled = false;
    }
  });
}
