/**
 * Processamento dos panoramas — no navegador, não no servidor.
 *
 * O panorama completo NÃO é recomprimido: o arquivo original vai para o disco byte a
 * byte. Escolha de 21/08/2026 — sem servidor online no horizonte não há banda para
 * economizar, e o que o cliente vê no Quest tem que ser a foto do equipamento. JPEG
 * de câmera 360 já sai comprimido; reencodar em cima disso é perda geracional que
 * nenhum ajuste de qualidade recupera depois.
 *
 * Prévia e miniatura seguem derivadas e pequenas, e não são luxo: são o que aparece
 * nos primeiros milissegundos, e a prévia é também o que mantém a memória do headset
 * em pé durante a travessia — ver o comentário de tetoAtual() em panorama.js.
 *
 *   completa   original   10–25 MB   sem recompressão; é o que o cliente vê no VR
 *   media      4096px     1–2 MB     o que o celular baixa; ver o porquê abaixo
 *   previa     1536px     ~150 KB    entra primeiro, para o ambiente aparecer na hora
 *   miniatura   480px      ~35 KB    tira de cenas e capa do acervo
 *
 * A MEDIA existe porque o celular baixava 23 MB para usar o equivalente a 2. Um
 * iPhone tem ~1180 px de tela de aparelho na horizontal; no enquadramento padrão de
 * 76° a textura só precisa de 360/76 × 1180 ≈ 5600 px para não amaciar. Os 4096 são
 * 0,73 disso — sub-amostra que não se enxerga em fotografia — por 1/15 do peso.
 *
 * Não é tile multirresolução: é um arquivo inteiro, como a prévia e a miniatura já
 * são, e a completa continua indo ao disco byte a byte. Quem escolhe entre as duas na
 * hora de exibir é panorama.js, não este módulo.
 */

import { dimensoesJpeg } from './panorama.js';

export const LARGURA_PREVIA = 1536;
export const LARGURA_MINIATURA = 480;

/**
 * Largura da derivada de tela.
 *
 * 4096 e não 6144: medido no acervo, a 6144 o arquivo sai entre 3 e 5 MB e fura a
 * meta de 3 MB por ambiente, que é a razão de a derivada existir. A perda no
 * enquadramento padrão é invisível; ela só aparece no zoom máximo, e é para isso que
 * panorama.js escala para a completa quando o visitante aproxima de verdade.
 */
export const LARGURA_MEDIA = 4096;

/**
 * Espelha LIMITE_UPLOAD em server.js. Acima deste tamanho o passe-livre é impossível
 * e o caminho de reencodar entra — os dois números têm que andar juntos.
 */
export const LIMITE_UPLOAD = 120 * 1024 * 1024;

/**
 * 0.98 vale só para o caso em que a original não pode ir crua (PNG, ou JPEG acima do
 * limite). Não há redução de largura nem aí: quem decide o tamanho é o teto de textura
 * do aparelho, na hora de exibir, não na hora de guardar.
 */
const QUALIDADE = { completa: 0.98, media: 0.86, previa: 0.8, miniatura: 0.78 };

/** Equirretangular é 2:1. Fora disso a projeção distorce e vale avisar. */
export const PROPORCAO_ESPERADA = 2;
const TOLERANCIA_PROPORCAO = 0.04;

function contexto(largura, altura) {
  if (typeof OffscreenCanvas === 'function') {
    const c = new OffscreenCanvas(largura, altura);
    return { canvas: c, ctx: c.getContext('2d') };
  }
  const c = document.createElement('canvas');
  c.width = largura;
  c.height = altura;
  return { canvas: c, ctx: c.getContext('2d') };
}

function paraBlob(canvas, qualidade) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/jpeg', quality: qualidade });
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', qualidade));
}

/**
 * Reduz preservando detalhe. Tenta o reamostrador do próprio navegador; se ele
 * ignorar as opções (Safari antigo), cai para redução por metades — descer 11000
 * para 1536 num único drawImage bilinear serraria as ripas do brise.
 */
async function reduzir(bitmap, larguraAlvo) {
  if (bitmap.width <= larguraAlvo) return bitmap;
  const alturaAlvo = Math.round((bitmap.height / bitmap.width) * larguraAlvo);

  try {
    const r = await createImageBitmap(bitmap, {
      resizeWidth: larguraAlvo,
      resizeHeight: alturaAlvo,
      resizeQuality: 'high',
    });
    if (r.width === larguraAlvo) return r;
    r.close?.();
  } catch {
    /* segue para o caminho manual */
  }

  let atual = bitmap;
  let meu = false;
  while (atual.width > larguraAlvo * 2) {
    const l = Math.max(larguraAlvo, Math.floor(atual.width / 2));
    const a = Math.max(1, Math.round((atual.height / atual.width) * l));
    const { canvas, ctx } = contexto(l, a);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(atual, 0, 0, l, a);
    const proximo = await createImageBitmap(canvas);
    if (meu) atual.close?.();
    atual = proximo;
    meu = true;
  }

  const { canvas, ctx } = contexto(larguraAlvo, alturaAlvo);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(atual, 0, 0, larguraAlvo, alturaAlvo);
  const final = await createImageBitmap(canvas);
  if (meu) atual.close?.();
  return final;
}

async function codificar(bitmap, larguraAlvo, qualidade) {
  const reduzido = await reduzir(bitmap, larguraAlvo);
  const { canvas, ctx } = contexto(reduzido.width, reduzido.height);
  ctx.drawImage(reduzido, 0, 0);
  const blob = await paraBlob(canvas, qualidade);
  if (reduzido !== bitmap) reduzido.close?.();
  return { blob, largura: canvas.width, altura: canvas.height };
}

/**
 * O panorama completo, sem recompressão quando dá.
 *
 * JPEG dentro do limite vai cru: mesmos bytes, zero perda geracional. PNG e arquivo
 * acima do limite não têm essa saída e são reencodados em 0.98, na largura original.
 *
 * Ressalva do passe-livre: a original conserva sua tag EXIF de orientação, enquanto a
 * prévia sai de um bitmap já rotacionado pelo imageOrientation from-image.
 * Equirretangular de câmera 360 vem sempre em orientação 1 e na prática as duas
 * concordam; foto girada num editor de imagem é o caso em que não concordariam.
 */
async function guardarCompleta(arquivo, bitmap, original, aoAndar) {
  const jpeg = arquivo.type === 'image/jpeg' || arquivo.type === 'image/jpg';
  if (jpeg && arquivo.size <= LIMITE_UPLOAD) {
    aoAndar('Mantendo original');
    return {
      blob: arquivo,
      largura: original.largura,
      altura: original.altura,
      recomprimida: false,
    };
  }
  aoAndar('Gerando imagem completa');
  const r = await codificar(bitmap, bitmap.width, QUALIDADE.completa);
  return { ...r, recomprimida: true };
}

/**
 * @param {File|Blob} arquivo
 * @param {(etapa: string) => void} [aoAndar]
 * @returns {Promise<{completa, previa, miniatura, largura, altura, proporcaoOk}>}
 */
export async function prepararPanorama(arquivo, aoAndar = () => {}) {
  aoAndar('Decodificando');
  let bitmap;
  try {
    bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Não foi possível ler a imagem. Envie JPEG ou PNG equirretangular.');
  }

  const proporcao = bitmap.width / bitmap.height;
  const proporcaoOk = Math.abs(proporcao - PROPORCAO_ESPERADA) <= TOLERANCIA_PROPORCAO * PROPORCAO_ESPERADA;
  const original = { largura: bitmap.width, altura: bitmap.height };

  try {
    const completa = await guardarCompleta(arquivo, bitmap, original, aoAndar);

    // Só faz sentido quando há o que reduzir: panorama já pequeno viraria uma
    // recompressão do mesmo tamanho, que é pior e não economiza nada.
    let media = null;
    if (bitmap.width > LARGURA_MEDIA) {
      aoAndar('Gerando imagem de tela');
      media = await codificar(bitmap, LARGURA_MEDIA, QUALIDADE.media);
    }

    aoAndar('Gerando prévia');
    const previa = await codificar(bitmap, Math.min(LARGURA_PREVIA, bitmap.width), QUALIDADE.previa);
    aoAndar('Gerando miniatura');
    const miniatura = await codificar(bitmap, Math.min(LARGURA_MINIATURA, bitmap.width), QUALIDADE.miniatura);

    return {
      completa,
      media,
      previa,
      miniatura,
      largura: completa.largura,
      altura: completa.altura,
      original,
      recomprimida: completa.recomprimida,
      proporcaoOk,
      proporcao,
    };
  } finally {
    bitmap.close?.();
  }
}

/**
 * Gera só a derivada de tela, a partir da completa que já está em disco.
 *
 * É o caminho do backfill: as cenas anteriores a esta derivada têm a completa e mais
 * nada, e regerar as quatro seria reprocessar 700 MB para nada.
 *
 * A diferença que importa está no decode. prepararPanorama() já tem o bitmap inteiro
 * na mão porque precisa dele para a prévia e a miniatura; aqui não, e decodificar
 * 11904×5952 só para reduzir a 4096 seriam 286 MB de RGBA vivos de uma vez. Então o
 * decode sai num degrau intermediário, lido do cabeçalho do JPEG, e o passe de metade
 * que sobra é o que preserva a ripa do brise — descer tudo num drawImage só serraria.
 *
 * @param {Blob} blob a imagem completa
 * @returns {Promise<{blob, largura, altura}|null>} null quando não há o que reduzir
 */
export async function prepararMedia(blob) {
  const dim = await dimensoesJpeg(blob);
  if (dim && dim.largura <= LARGURA_MEDIA) return null;

  const degrau = LARGURA_MEDIA * 2;
  let bitmap = null;
  if (dim && dim.largura > degrau) {
    try {
      bitmap = await createImageBitmap(blob, {
        resizeWidth: degrau,
        resizeHeight: Math.round((dim.altura / dim.largura) * degrau),
        resizeQuality: 'high',
      });
    } catch {
      /* navegador que ignora as opções: cai no decode inteiro */
    }
  }
  if (!bitmap) bitmap = await createImageBitmap(blob);

  try {
    if (bitmap.width <= LARGURA_MEDIA) return null;
    return await codificar(bitmap, LARGURA_MEDIA, QUALIDADE.media);
  } finally {
    bitmap.close?.();
  }
}

/**
 * Foto de compartilhamento — a miniatura que o WhatsApp e o e-mail mostram.
 *
 * 1200x630 e o formato que o Facebook, o WhatsApp e o LinkedIn esperam; fora dele o
 * recorte fica por conta deles e costuma cortar no lugar errado. O recorte e "cover"
 * pelo centro: preenche o quadro sem esticar, que e o que uma foto de fachada pede.
 *
 * Nao e um panorama, e por isso nao passa pelas derivadas: e a foto do
 * empreendimento, com o enquadramento que o fotografo escolheu.
 */
export const LARGURA_COMPARTILHAR = 1200;
export const ALTURA_COMPARTILHAR = 630;

/**
 * Recorte "cover" para o centro do quadro.
 *
 * Reduz a imagem inteira ANTES de recortar, ate o menor tamanho que ainda cobre o
 * alvo. Assim o recorte cai 1:1 e o drawImage nao precisa reduzir nada — que e o que
 * serrilharia uma fachada de brise vista de longe.
 */
async function recortarCover(bitmap, largura, altura) {
  const escala = Math.max(largura / bitmap.width, altura / bitmap.height);
  const fonte = escala < 1 ? await reduzir(bitmap, Math.round(bitmap.width * escala)) : bitmap;

  const f = Math.max(largura / fonte.width, altura / fonte.height);
  const lRegiao = Math.min(fonte.width, largura / f);
  const aRegiao = Math.min(fonte.height, altura / f);

  const { canvas, ctx } = contexto(largura, altura);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    fonte,
    (fonte.width - lRegiao) / 2, (fonte.height - aRegiao) / 2, lRegiao, aRegiao,
    0, 0, largura, altura,
  );
  if (fonte !== bitmap) fonte.close?.();
  return canvas;
}

/**
 * @param {File|Blob} arquivo foto do empreendimento, em qualquer proporcao
 * @returns {Promise<{blob, largura, altura, pequena: boolean}>}
 */
export async function prepararCompartilhar(arquivo) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Não foi possível ler a imagem. Envie JPEG ou PNG.');
  }
  try {
    // Foto menor que o quadro vai ser ampliada; quem sobe merece saber antes de o
    // link circular borrado para um arquiteto.
    const pequena = bitmap.width < LARGURA_COMPARTILHAR || bitmap.height < ALTURA_COMPARTILHAR;
    const canvas = await recortarCover(bitmap, LARGURA_COMPARTILHAR, ALTURA_COMPARTILHAR);
    const blob = await paraBlob(canvas, 0.85);
    return { blob, largura: LARGURA_COMPARTILHAR, altura: ALTURA_COMPARTILHAR, pequena };
  } finally {
    bitmap.close?.();
  }
}

export function formatarBytes(n) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
