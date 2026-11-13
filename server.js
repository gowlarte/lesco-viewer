/**
 * Lesco Viewer — servidor do editor.
 *
 * Existe apenas do lado interno: recebe upload, grava tour.json em disco e monta o
 * pacote estatico do lado publico. Usa somente modulos nativos do Node, de proposito —
 * o projeto nao tem npm install, nao tem build, e o que sai do export e HTML puro.
 *
 *   node server.js            sobe o editor em http://127.0.0.1:4360
 *   node server.js --rede     escuta em toda a rede local (ver aviso abaixo)
 *   node server.js --export   gera dist/ e sai
 *
 * SOBRE --rede: a API do editor nao tem autenticacao. Gravar e apagar tour, e apagar
 * as fotos de uma obra, sao requisicoes sem credencial. Com --rede isso fica ao alcance
 * de qualquer aparelho da rede local. E deliberado, para poder abrir o tour no celular,
 * e por isso mora numa flag: o padrao continua preso ao 127.0.0.1.
 */

import { createServer } from 'node:http';
import { createServer as createServerTls } from 'node:https';
import { connect } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { readFile, writeFile, readdir, mkdir, rm, cp, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { URL_BASE, MARCA } from './config.js';
// Vocabulario do produto, para o nome do tipo de obra nao divergir entre a ficha e a
// meta tag. comum.js so toca no DOM dentro de funcao — nada roda ao importar.
import { TIPOS_OBRA } from './app/js/comum.js';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const DIR_DADOS = join(RAIZ, 'data');
const DIR_TOURS = join(DIR_DADOS, 'tours');
const DIR_MIDIA = join(RAIZ, 'media');
const DIR_DIST = join(RAIZ, 'dist');
const PORTA = Number(process.env.PORT) || 4360;

/** Exposicao na rede e escolha por execucao, nunca padrao. */
const REDE = process.argv.includes('--rede') || process.env.HOST === '0.0.0.0';
const HOST = REDE ? '0.0.0.0' : '127.0.0.1';

/**
 * HTTPS existe por causa do VR: WebXR so opera em contexto seguro, e o headset e outro
 * aparelho — em http://IP o navigator.xr nao e nem definido. O certificado vem de
 * ferramentas/gerar-certificado.ps1 e o Node le o PFX direto, sem conversao para PEM,
 * que exigiria openssl.
 */
const TLS = process.argv.includes('--https');
const DIR_CERT = join(RAIZ, 'cert');
const ARQ_PFX = join(DIR_CERT, 'lesco-viewer.pfx');
const ARQ_SENHA = join(DIR_CERT, 'senha.txt');

function credenciais() {
  if (!existsSync(ARQ_PFX) || !existsSync(ARQ_SENHA)) return null;
  return {
    pfx: readFileSync(ARQ_PFX),
    passphrase: readFileSync(ARQ_SENHA, 'utf8').trim(),
  };
}

const ESQUEMA = TLS ? 'https' : 'http';

/**
 * O panorama completo sobe sem recompressao (ver imagem.js), entao o que passa aqui e
 * o arquivo da camera: 10-25 MB no caso comum, mais que isso num equipamento de 72 MP
 * ou num PNG. 120 MB cobre com folga. Editor local, disco local: nao ha custo de banda
 * nem de armazenamento a defender neste numero.
 *
 * Espelhado em LIMITE_UPLOAD em app/js/imagem.js, que decide por ele se a original
 * pode ir crua. Os dois tem que andar juntos.
 */
const LIMITE_UPLOAD = 120 * 1024 * 1024;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// ── utilidades ──────────────────────────────────────────────────────────────

/** "Resort Jurerê Internacional" -> "resort-jurere-internacional" */
export function slugificar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'tour';
}

/** Aceita apenas o formato que o proprio editor gera. Barra a subida de diretorio. */
function slugSeguro(valor) {
  return /^[a-z0-9][a-z0-9-]{0,59}$/.test(valor || '') ? valor : null;
}

/** Nome de arquivo de midia: c3.jpg, c3.media.jpg, c3.preview.jpg, c3.thumb.jpg, compartilhar.jpg */
function midiaSegura(valor) {
  return /^[a-z0-9]+(\.media|\.preview|\.thumb)?\.jpg$/.test(valor || '') ? valor : null;
}

/** Escapa para atributo HTML. O texto vem de campo livre da ficha da obra. */
function escHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Corta na palavra, nao no meio dela. 160 e o que os previews de link mostram. */
function resumir(texto, max = 160) {
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
  if (limpo.length <= max) return limpo;
  const corte = limpo.slice(0, max - 1);
  const espaco = corte.lastIndexOf(' ');
  return `${espaco > max * 0.6 ? corte.slice(0, espaco) : corte}…`;
}

const nomeTipoObra = (id) => TIPOS_OBRA.find((t) => t.id === id)?.nome || id || '';

function jsonOk(res, dados, status = 200) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(corpo),
    'cache-control': 'no-store',
  });
  res.end(corpo);
}

function erro(res, status, mensagem) {
  jsonOk(res, { erro: mensagem }, status);
}

function lerCorpo(req, limite = LIMITE_UPLOAD) {
  return new Promise((resolve, reject) => {
    const pedacos = [];
    let total = 0;
    req.on('data', (p) => {
      total += p.length;
      if (total > limite) {
        reject(new Error('corpo excede o limite de upload'));
        req.destroy();
        return;
      }
      pedacos.push(p);
    });
    req.on('end', () => resolve(Buffer.concat(pedacos)));
    req.on('error', reject);
  });
}

async function existe(caminho) {
  try {
    await stat(caminho);
    return true;
  } catch {
    return false;
  }
}

/** Corpo JSON de uma requisicao da API. Devolve null se vier vazio ou malformado. */
async function lerJsonCorpo(req) {
  try {
    return JSON.parse((await lerCorpo(req, 4 * 1024 * 1024)).toString('utf8'));
  } catch {
    return null;
  }
}

async function lerJson(caminho, padrao = null) {
  try {
    return JSON.parse(await readFile(caminho, 'utf8'));
  } catch {
    return padrao;
  }
}

async function gravarJson(caminho, dados) {
  await mkdir(dirname(caminho), { recursive: true });
  await writeFile(caminho, JSON.stringify(dados, null, 2), 'utf8');
}

// ── modelo dos tours ────────────────────────────────────────────────────────

const arquivoTour = (slug) => join(DIR_TOURS, slug, 'tour.json');

async function listarSlugs() {
  try {
    const itens = await readdir(DIR_TOURS, { withFileTypes: true });
    return itens.filter((i) => i.isDirectory() && slugSeguro(i.name)).map((i) => i.name);
  } catch {
    return [];
  }
}

/**
 * A obra publicada esta no pacote do jeito que esta em data/?
 *
 * Compara o `atualizadoEm` da ficha com o `atualizadoEm` da copia dentro de dist/, e
 * nao o mtime dos arquivos: mtime depende de o fs.cp preservar timestamp, que muda
 * entre plataforma e versao do Node, e a resposta certa nao pode depender disso. Dois
 * campos iguais e o pacote em dia; diferentes e o pacote atras. Sem folga a calibrar.
 */
async function pacoteDesatualizado(slug, atualizadoEm) {
  const copia = await lerJson(join(DIR_DIST, 'data', 'tours', slug, 'tour.json'));
  // Publicada e sem copia no pacote: nunca chegou a ir ao ar. E a pior divergencia.
  if (!copia) return true;
  return (copia.atualizadoEm || '') !== (atualizadoEm || '');
}

/**
 * O indice e derivado, nunca editado a mao: carrega cada tour.json e projeta so o
 * que a capa do acervo precisa. Assim nao existe estado duplicado para dessincronizar.
 *
 * `compararPacote` so vale para o editor. O indice que vai dentro do pacote nao
 * carrega essa comparacao — falar do proprio dist/ dentro do dist/ nao faz sentido.
 */
async function montarIndice({ somentePublicados = false, compararPacote = false } = {}) {
  const tours = [];
  for (const slug of await listarSlugs()) {
    const tour = await lerJson(arquivoTour(slug));
    if (!tour) continue;
    if (somentePublicados && !tour.publicado) continue;

    const cenas = Array.isArray(tour.cenas) ? tour.cenas : [];
    const capa = cenas.find((c) => c.id === tour.capaCenaId) || cenas[0] || null;
    tours.push({
      slug,
      obra: tour.obra || '',
      cidade: tour.cidade || '',
      uf: tour.uf || '',
      tipo: tour.tipo || '',
      ano: tour.ano || null,
      escritorio: tour.escritorio || '',
      linhas: Array.isArray(tour.linhas) ? tour.linhas : [],
      apresentacao: tour.apresentacao || '',
      publicado: !!tour.publicado,
      totalCenas: cenas.length,
      // Derivado do id, como em caminhosDaCena() no cliente. Guardar o nome do
      // arquivo na cena seria estado duplicado com uma unica convencao possivel.
      capaThumb: capa ? `/media/${slug}/${capa.id}.thumb.jpg` : null,
      atualizadoEm: tour.atualizadoEm || null,
      ...(compararPacote
        ? { pacoteDesatualizado: !!tour.publicado && (await pacoteDesatualizado(slug, tour.atualizadoEm)) }
        : {}),
    });
  }
  tours.sort((a, b) => (b.ano || 0) - (a.ano || 0) || a.obra.localeCompare(b.obra, 'pt-BR'));
  return { geradoEm: new Date().toISOString(), tours };
}

function tourNovo(dados = {}) {
  const agora = new Date().toISOString();
  return {
    slug: dados.slug,
    obra: dados.obra || 'Obra sem nome',
    cidade: dados.cidade || '',
    uf: dados.uf || '',
    tipo: dados.tipo || 'residencia',
    ano: dados.ano || new Date().getFullYear(),
    escritorio: dados.escritorio || '',
    linhas: [],
    apresentacao: '',
    publicado: false,
    capaCenaId: null,
    cenas: [],
    criadoEm: agora,
    atualizadoEm: agora,
  };
}

// ── API ─────────────────────────────────────────────────────────────────────

async function api(req, res, url) {
  const partes = url.pathname.split('/').filter(Boolean).slice(1); // remove "api"
  const [recurso, a, b] = partes;
  const metodo = req.method;

  if (recurso === 'tours' && !a) {
    if (metodo === 'GET') return jsonOk(res, await montarIndice({ compararPacote: true }));
    if (metodo === 'POST') {
      const corpo = await lerJsonCorpo(req);
      if (!corpo?.obra?.trim()) return erro(res, 400, 'Informe o nome da obra.');

      // Colisao de nome nao pode sobrescrever obra existente: sufixa -2, -3...
      const base = slugificar(corpo.obra);
      let slug = base;
      for (let n = 2; await existe(arquivoTour(slug)); n += 1) slug = `${base}-${n}`;

      const tour = tourNovo({ ...corpo, slug });
      await gravarJson(arquivoTour(slug), tour);
      return jsonOk(res, tour, 201);
    }
    return erro(res, 405, 'Metodo nao permitido.');
  }

  if (recurso === 'tours' && a) {
    const slug = slugSeguro(a);
    if (!slug) return erro(res, 400, 'Identificador de tour invalido.');
    const arquivo = arquivoTour(slug);

    if (metodo === 'GET') {
      const tour = await lerJson(arquivo);
      return tour ? jsonOk(res, tour) : erro(res, 404, 'Tour nao encontrado.');
    }

    if (metodo === 'PUT') {
      const anterior = await lerJson(arquivo);
      if (!anterior) return erro(res, 404, 'Tour nao encontrado.');
      const corpo = await lerJsonCorpo(req);
      if (!corpo) return erro(res, 400, 'Corpo invalido.');
      const tour = {
        ...anterior,
        ...corpo,
        slug, // a rota manda, nunca o corpo
        criadoEm: anterior.criadoEm,
        atualizadoEm: new Date().toISOString(),
      };
      await gravarJson(arquivo, tour);
      return jsonOk(res, tour);
    }

    if (metodo === 'DELETE') {
      await rm(join(DIR_TOURS, slug), { recursive: true, force: true });
      await rm(join(DIR_MIDIA, slug), { recursive: true, force: true });
      return jsonOk(res, { removido: slug });
    }

    return erro(res, 405, 'Metodo nao permitido.');
  }

  if (recurso === 'media' && a && b) {
    const slug = slugSeguro(a);
    const arquivo = midiaSegura(b);
    if (!slug || !arquivo) return erro(res, 400, 'Caminho de midia invalido.');
    const destino = join(DIR_MIDIA, slug, arquivo);

    if (metodo === 'PUT') {
      let bytes;
      try {
        bytes = await lerCorpo(req);
      } catch {
        return erro(res, 413, `Imagem acima do limite de ${LIMITE_UPLOAD / (1024 * 1024)} MB.`);
      }
      if (!bytes.length) return erro(res, 400, 'Imagem vazia.');
      await mkdir(dirname(destino), { recursive: true });
      await writeFile(destino, bytes);
      return jsonOk(res, { arquivo: `/media/${slug}/${arquivo}`, bytes: bytes.length });
    }

    if (metodo === 'DELETE') {
      // Uma cena tem quatro derivadas; apagar a cena apaga as quatro.
      const raizCena = arquivo.replace(/(\.media|\.preview|\.thumb)?\.jpg$/, '');
      await Promise.all(
        ['.jpg', '.media.jpg', '.preview.jpg', '.thumb.jpg'].map((sufixo) =>
          rm(join(DIR_MIDIA, slug, raizCena + sufixo), { force: true }),
        ),
      );
      return jsonOk(res, { removido: raizCena });
    }

    return erro(res, 405, 'Metodo nao permitido.');
  }

  /**
   * Como este servidor esta alcancavel de fora da maquina. So o editor consome, e so
   * para montar o QR: digitar https://172.16.x.x:4360 no teclado virtual do Quest e a
   * tarefa mais irritante do fluxo de validacao em VR.
   */
  if (recurso === 'rede' && !a && metodo === 'GET') {
    return jsonOk(res, {
      rede: REDE,
      esquema: ESQUEMA,
      porta: PORTA,
      enderecos: REDE ? enderecosLan() : [],
    });
  }

  if (recurso === 'export' && metodo === 'POST') {
    const resultado = await exportar();
    return jsonOk(res, resultado);
  }

  return erro(res, 404, 'Rota inexistente.');
}

// ── export estatico ─────────────────────────────────────────────────────────

/**
 * O que o lado publico precisa para funcionar — e nada mais.
 *
 * Copiar app/ inteiro levaria o editor, o cliente da API e o pipeline de imagem para
 * dentro de um deploy aberto. Nao quebraria nada, mas publicaria codigo interno e a
 * forma da API para qualquer visitante que abrisse o devtools. A lista e explicita
 * de proposito: arquivo novo do lado publico tem que ser declarado aqui.
 */
const ARQUIVOS_PUBLICOS = {
  css: ['tokens.css', 'base.css', 'panorama.css', 'publico.css', 'constelacao.css'],
  js: [
    'comum.js', 'icones.js', 'panorama.js', 'hotspots.js', 'vr.js',
    'publico-acervo.js', 'publico-tour.js', 'publico-constelacao.js',
  ],
  assets: ['logo-lesco.png'],
};

/** A foto de compartilhamento e da obra, nao de uma cena. Espelha api.js. */
const ARQUIVO_COMPARTILHAR = 'compartilhar.jpg';

/**
 * Meta tags de compartilhamento, assadas no HTML.
 *
 * Assadas, e nao injetadas por JS, porque o robo do WhatsApp le o arquivo servido e
 * nao executa script nenhum. Sem isto o link circula como texto cru — e link sem
 * miniatura nao e clicado, que e o problema inteiro que este bloco resolve.
 *
 * `imagem` e {url, largura, altura} ou null. Sem URL_BASE nao ha imagem possivel:
 * og:image exige endereco absoluto, porque quem le esta em outro servidor.
 */
function metasSociais({ ogTitulo, descricao, url, imagem }) {
  const linhas = [
    `<meta name="description" content="${escHtml(descricao)}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="pt_BR">',
    `<meta property="og:site_name" content="${escHtml(MARCA)}">`,
    `<meta property="og:title" content="${escHtml(ogTitulo)}">`,
    `<meta property="og:description" content="${escHtml(descricao)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escHtml(ogTitulo)}">`,
    `<meta name="twitter:description" content="${escHtml(descricao)}">`,
  ];
  if (url) linhas.push(`<meta property="og:url" content="${escHtml(url)}">`);
  if (imagem) {
    linhas.push(
      `<meta property="og:image" content="${escHtml(imagem.url)}">`,
      `<meta property="og:image:width" content="${imagem.largura}">`,
      `<meta property="og:image:height" content="${imagem.altura}">`,
      `<meta name="twitter:image" content="${escHtml(imagem.url)}">`,
    );
  }
  return linhas.join('\n');
}

/**
 * Troca o titulo do molde e planta o bloco de metas na marca.
 *
 * A description estatica do molde sai junto: duas na mesma pagina e ambiguidade para
 * o robo, e a que vale e a que sabe de qual obra estamos falando.
 */
function aplicarMetas(molde, titulo, bloco) {
  return molde
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escHtml(titulo)}</title>`)
    .replace(/[ \t]*<meta name="description"[^>]*>\r?\n?/, '')
    .replace('<!--META-->', bloco);
}

/**
 * A miniatura do link.
 *
 * Primeiro a foto do empreendimento, se ela foi subida na ficha da obra: e a peca
 * que o comercial escolheu e a que um arquiteto reconhece. Sem ela, a previa da cena
 * de capa — equirretangular, entao com teto e piso esticados. Isso serve para o link
 * nao circular pelado, nao para ficar bonito, e o editor diz isso na cara.
 */
async function imagemSocial(slug, tour) {
  if (!URL_BASE) return null;
  if (await existe(join(DIR_MIDIA, slug, ARQUIVO_COMPARTILHAR))) {
    return { url: `${URL_BASE}/media/${slug}/${ARQUIVO_COMPARTILHAR}`, largura: 1200, altura: 630, propria: true };
  }
  const cenas = Array.isArray(tour.cenas) ? tour.cenas : [];
  const capa = cenas.find((c) => c.id === tour.capaCenaId) || cenas[0];
  if (!capa) return null;
  return { url: `${URL_BASE}/media/${slug}/${capa.id}.preview.jpg`, largura: 1536, altura: 768, propria: false };
}

/**
 * Monta dist/ como um site pronto para a Vercel: uma capa com o acervo e uma pasta
 * por obra, servida como /resort-jurere. Vao somente os tours publicados — o que
 * ainda esta em edicao nunca sai daqui.
 */
async function exportar() {
  const indice = await montarIndice({ somentePublicados: true });
  await rm(DIR_DIST, { recursive: true, force: true });
  await mkdir(DIR_DIST, { recursive: true });

  for (const [pasta, arquivos] of Object.entries(ARQUIVOS_PUBLICOS)) {
    await mkdir(join(DIR_DIST, 'app', pasta), { recursive: true });
    for (const arquivo of arquivos) {
      await cp(join(RAIZ, 'app', pasta, arquivo), join(DIR_DIST, 'app', pasta, arquivo));
    }
  }
  await gravarJson(join(DIR_DIST, 'data', 'index.json'), indice);

  const moldeAcervo = await readFile(join(RAIZ, 'index.html'), 'utf8');
  const moldeTour = await readFile(join(RAIZ, 'tour.html'), 'utf8');

  const avisos = [];
  if (!URL_BASE) {
    avisos.push(
      'URL_BASE esta vazia em config.js: o pacote sai sem og:image e sem og:url, '
      + 'entao o link circula sem miniatura. Preencha o endereco de producao e regere.',
    );
  }
  const semFoto = [];

  for (const t of indice.tours) {
    const tour = await lerJson(arquivoTour(t.slug));
    await cp(arquivoTour(t.slug), join(DIR_DIST, 'data', 'tours', t.slug, 'tour.json'));
    if (await existe(join(DIR_MIDIA, t.slug))) {
      await cp(join(DIR_MIDIA, t.slug), join(DIR_DIST, 'media', t.slug), { recursive: true });
    }

    const lugar = [t.cidade, t.uf].filter(Boolean).join('/');
    const imagem = await imagemSocial(t.slug, tour || {});
    if (URL_BASE && !imagem?.propria) semFoto.push(t.slug);

    const html = aplicarMetas(
      // O slug fica fixado no HTML: a pagina exportada nao depende de query string.
      moldeTour.replace(
        '<!--SLUG-->',
        `<script>window.__TOUR_SLUG__=${JSON.stringify(t.slug)}</script>`,
      ),
      `${t.obra} — Tour 360 Lesco`,
      metasSociais({
        ogTitulo: lugar ? `${t.obra} — ${lugar}` : t.obra,
        descricao: resumir(t.apresentacao)
          || [
            'Tour virtual 360°',
            nomeTipoObra(t.tipo),
            `${t.totalCenas} ${t.totalCenas === 1 ? 'ambiente' : 'ambientes'}`,
            MARCA,
          ].filter(Boolean).join(' · '),
        url: URL_BASE ? `${URL_BASE}/${t.slug}` : '',
        imagem,
      }),
    );
    await mkdir(join(DIR_DIST, t.slug), { recursive: true });
    await writeFile(join(DIR_DIST, t.slug, 'index.html'), html, 'utf8');
  }

  if (semFoto.length) {
    avisos.push(
      `Sem foto de compartilhamento: ${semFoto.join(', ')}. O link vai levar a previa `
      + 'equirretangular da capa, que sai com o teto e o piso esticados. Suba uma foto '
      + 'do empreendimento na ficha da obra.',
    );
  }

  // A capa do acervo mostra a obra mais recente como miniatura: e a cara do acervo e
  // nao exige um asset institucional que hoje nao existe.
  const primeira = indice.tours[0];
  const imagemAcervo = primeira ? await imagemSocial(primeira.slug, await lerJson(arquivoTour(primeira.slug)) || {}) : null;

  // No pacote cada obra vira a pasta /slug/; em desenvolvimento e /tour?t=slug.
  // A marca abaixo e o que faz o acervo montar o endereco certo em cada situacao.
  await writeFile(
    join(DIR_DIST, 'index.html'),
    aplicarMetas(
      moldeAcervo.replace('<!--MODO-->', '<script>window.__ESTATICO__=true</script>'),
      'Tours 360 — Lesco',
      metasSociais({
        ogTitulo: 'Obras para percorrer — Tours 360 Lesco',
        descricao:
          'Obras entregues da Lesco em tour 360: brise, painel e Green Brise aplicados, '
          + 'navegáveis ambiente por ambiente.',
        url: URL_BASE,
        imagem: imagemAcervo,
      }),
    ),
    'utf8',
  );

  // Capa alternativa: mesmo indice, arranjo em constelacao. Vai como pasta propria
  // para o endereco ficar /constelacao, e nao /constelacao.html.
  const moldeConstelacao = await readFile(join(RAIZ, 'constelacao.html'), 'utf8');
  await mkdir(join(DIR_DIST, 'constelacao'), { recursive: true });
  await writeFile(
    join(DIR_DIST, 'constelacao', 'index.html'),
    aplicarMetas(
      moldeConstelacao.replace('<!--MODO-->', '<script>window.__ESTATICO__=true</script>'),
      'Constelação — Tours 360 Lesco',
      metasSociais({
        ogTitulo: 'Constelação — Tours 360 Lesco',
        descricao:
          'As obras entregues da Lesco espalhadas em constelação. Passe pelo ambiente '
          + 'para vê-lo em cor e entre no tour 360.',
        url: URL_BASE ? `${URL_BASE}/constelacao` : '',
        imagem: imagemAcervo,
      }),
    ),
    'utf8',
  );

  // Panorama e imutavel depois de publicado; o HTML precisa poder ser corrigido.
  await gravarJson(join(DIR_DIST, 'vercel.json'), {
    headers: [
      {
        source: '/media/(.*)',
        headers: [{ key: 'cache-control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/app/(.*)',
        headers: [{ key: 'cache-control', value: 'public, max-age=3600' }],
      },
      // Depois da regra ampla de propósito: a Vercel deixa a última correspondência
      // mandar, e esta é a única mídia com nome fixo — trocar a foto e continuar
      // servindo a antiga por um ano seria irreversível na prática.
      {
        source: `/media/(.*)/${ARQUIVO_COMPARTILHAR}`,
        headers: [{ key: 'cache-control', value: 'public, max-age=3600' }],
      },
    ],
  });

  return { tours: indice.tours.length, destino: DIR_DIST, avisos };
}

// ── estatico ────────────────────────────────────────────────────────────────

async function servirArquivo(res, caminho, { cache = 'no-store' } = {}) {
  try {
    const info = await stat(caminho);
    if (!info.isFile()) return false;
    const bytes = await readFile(caminho);
    res.writeHead(200, {
      'content-type': TIPOS[extname(caminho).toLowerCase()] || 'application/octet-stream',
      'content-length': bytes.length,
      'cache-control': cache,
    });
    res.end(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Resolve dentro da raiz do projeto e recusa qualquer coisa que escape dela. */
function resolverDentroDaRaiz(pathname) {
  const relativo = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const alvo = join(RAIZ, relativo);
  return alvo === RAIZ || alvo.startsWith(RAIZ + sep) ? alvo : null;
}

async function requisicao(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  } catch {
    return erro(res, 400, 'URL invalida.');
  }
  const p = url.pathname;

  if (p.startsWith('/api/')) {
    try {
      return await api(req, res, url);
    } catch (e) {
      console.error('[api]', e);
      return erro(res, 500, e.message || 'Falha interna.');
    }
  }

  // O visualizador publico le sempre /data/index.json. Em dev o arquivo nao existe:
  // e gerado aqui, na mesma URL, para o codigo do lado publico ser um so.
  if (p === '/data/index.json') return jsonOk(res, await montarIndice({ somentePublicados: false }));

  // Paginas
  if (p === '/' || p === '/index.html') return void (await servirArquivo(res, join(RAIZ, 'index.html')));
  if (p === '/constelacao' || p === '/constelacao.html')
    return void (await servirArquivo(res, join(RAIZ, 'constelacao.html')));
  if (p === '/tour' || p === '/tour.html') return void (await servirArquivo(res, join(RAIZ, 'tour.html')));
  if (p === '/gestao' || p === '/gestao/') return void (await servirArquivo(res, join(RAIZ, 'gestao', 'index.html')));
  if (p === '/gestao/tour' || p === '/gestao/tour.html')
    return void (await servirArquivo(res, join(RAIZ, 'gestao', 'tour.html')));

  // Assets, dados e midia
  if (/^\/(app|data|media)\//.test(p)) {
    const alvo = resolverDentroDaRaiz(p);
    if (alvo && (await servirArquivo(res, alvo))) return;
  }

  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8"><title>404</title>' +
    '<body style="font:400 14px system-ui;padding:48px;color:#353535;background:#EEE">' +
    '<p>Nada nesta rota.</p><p><a href="/gestao">Gestao</a> · <a href="/">Acervo</a></p>');
}

// ── entrada ─────────────────────────────────────────────────────────────────

await mkdir(DIR_TOURS, { recursive: true });
await mkdir(DIR_MIDIA, { recursive: true });

if (process.argv.includes('--export')) {
  const r = await exportar();
  console.log(`Export concluido: ${r.tours} tour(s) publicado(s) em ${r.destino}`);
  for (const aviso of r.avisos) console.log(`  aviso: ${aviso}`);
  process.exit(0);
}

/**
 * Enderecos IPv4 reais da maquina. Imprimir isto evita a caca ao ipconfig toda vez
 * que se quer abrir o tour no celular. Link-local (169.254.x) fica fora: nunca e
 * o endereco por onde outro aparelho chega.
 */
function enderecosLan() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i.address);
}

/**
 * No Windows, escutar em 0.0.0.0 nao colide com um bind previo em 127.0.0.1: o sistema
 * aceita os dois e passa a entregar requisicao de localhost a um processo e requisicao
 * da rede a outro. Dois servidores no mesmo data/, sem erro nenhum na tela — o tipo de
 * coisa que se perde uma tarde para descobrir. Aqui a porta e sondada antes de subir.
 */
function portaOcupada() {
  return new Promise((resolve) => {
    const s = connect({ port: PORTA, host: '127.0.0.1' });
    const fim = (valor) => {
      s.destroy();
      resolve(valor);
    };
    s.setTimeout(600, () => fim(false));
    s.once('connect', () => fim(true));
    s.once('error', () => fim(false));
  });
}

if (await portaOcupada()) {
  // A dica de porta alternativa precisa sair na sintaxe do shell de quem esta lendo:
  // PORT=4361 npm run dev e bash e nao funciona no PowerShell, que e o padrao no Windows.
  const outraPorta = process.platform === 'win32'
    ? `$env:PORT=${PORTA + 1}; npm run dev`
    : `PORT=${PORTA + 1} npm run dev`;

  console.error(
    `\n  A porta ${PORTA} ja esta em uso — provavelmente outro servidor do Lesco Viewer,`
      + '\n  ou o preview aberto pelo Claude Code.\n'
      + '\n  Encerre o outro (Ctrl+C na janela dele) e tente de novo, ou suba numa porta livre:\n'
      + `\n    ${outraPorta}\n`
      + `\n  Para descobrir quem esta na porta: netstat -ano | findstr :${PORTA}\n`,
  );
  process.exit(1);
}

let cred = null;
if (TLS) {
  cred = credenciais();
  if (!cred) {
    console.error(
      '\n  Modo https pedido, mas nao existe certificado em cert/.\n'
        + '  Gere uma vez:\n\n'
        + '    powershell -ExecutionPolicy Bypass -File ferramentas/gerar-certificado.ps1\n',
    );
    process.exit(1);
  }
}

const servidor = TLS ? createServerTls(cred, requisicao) : createServer(requisicao);

servidor.listen(PORTA, HOST, () => {
  const linhas = [
    '',
    '  LESCO VIEWER',
    '  ARQUITETURA FEITA PARA O AMANHA',
    '',
    `  Gestao   ${ESQUEMA}://127.0.0.1:${PORTA}/gestao`,
    `  Acervo   ${ESQUEMA}://127.0.0.1:${PORTA}/`,
    '',
  ];

  if (!REDE) {
    linhas.push('  Escutando so em 127.0.0.1. Para abrir de outro aparelho: npm run dev:rede', '');
  } else {
    const ips = enderecosLan();
    linhas.push('  NA REDE LOCAL');
    if (ips.length) {
      for (const ip of ips) linhas.push(`    ${ESQUEMA}://${ip}:${PORTA}/`);
    } else {
      linhas.push('    nenhuma interface de rede ativa encontrada');
    }
    linhas.push(
      '',
      '  Sem autenticacao: qualquer aparelho que alcance esta porta pode apagar',
      '  tours e fotos. Nao deixe rodando assim em rede que voce nao controla.',
      '',
    );
    if (TLS) {
      linhas.push(
        '  VR e giroscopio disponiveis: contexto seguro.',
        '  O headset vai acusar certificado nao confiavel — aceite o aviso e siga.',
        '',
      );
    } else {
      linhas.push(
        '  Sem VR e sem giroscopio: os dois exigem contexto seguro.',
        '  Para o headset, suba com: npm run dev:vr',
        '',
      );
    }
  }

  console.log(linhas.join('\n'));
});
