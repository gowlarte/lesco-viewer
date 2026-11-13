/**
 * Renderizador equirretangular — WebGL2, sem dependência.
 *
 * Não existe malha de esfera: o panorama é um quad de tela cheia e o fragment shader
 * calcula, por pixel, a direção do raio e amostra a foto. Duas consequências que
 * importam para a Lesco: nenhum artefato de tesselação nas ripas do brise, e a
 * travessia entre ambientes é um mix de duas texturas no mesmo passe — barato e liso.
 *
 * A amostragem usa textureGrad com a derivada corrigida na costura. Sem isso, a
 * faixa vertical onde u salta de 1 para 0 escolheria o mip mais grosso e apareceria
 * como uma listra borrada no meio da parede.
 */

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vNdc;
void main() {
  vNdc = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;

in vec2 vNdc;
out vec4 corFinal;

/**
 * Base do raio: leva NDC (x, y, 1) direto para a direcao em mundo, ja com projecao
 * e rotacao embutidas.
 *
 * Antes eram duas coisas separadas, uma meia-abertura em tangente mais uma rotacao,
 * o que assume frustum SIMETRICO. Cada olho de headset tem frustum assimetrico — o
 * centro optico e deslocado para fora — e naquela formulacao a imagem entortaria nas
 * bordas. Uma matriz unica cobre os dois casos.
 */
uniform mat3 uRaio;
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uMix;

const float PI = 3.141592653589793;

vec2 paraEquirretangular(vec3 d) {
  return vec2(
    atan(d.x, -d.z) / (2.0 * PI) + 0.5,
    acos(clamp(d.y, -1.0, 1.0)) / PI
  );
}

void main() {
  vec3 dir = normalize(uRaio * vec3(vNdc, 1.0));

  vec2 uv = paraEquirretangular(dir);
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);

  // Na costura, u salta ~1.0 entre pixels vizinhos. Sem esta correcao o mip cai
  // para o nivel mais grosso e aparece uma listra borrada vertical na imagem.
  if (abs(dx.x) > 0.5) dx.x -= sign(dx.x);
  if (abs(dy.x) > 0.5) dy.x -= sign(dy.x);

  vec4 a = textureGrad(uTexA, uv, dx, dy);
  if (uMix <= 0.0) { corFinal = a; return; }

  vec4 b = textureGrad(uTexB, uv, dx, dy);
  corFinal = mix(a, b, uMix);
}`;

export const FOV_MIN = 28;
export const FOV_MAX = 100;
export const FOV_PADRAO = 76;

/**
 * Largura da derivada de tela. Espelha LARGURA_MEDIA em app/js/imagem.js — os dois
 * numeros tem que andar juntos, como LIMITE_UPLOAD ja anda com server.js. Nao da para
 * importar: imagem.js e so da gestao e nao vai no pacote publico.
 */
const LARGURA_MEDIA = 4096;

/**
 * Sub-amostra que ainda nao se ve.
 *
 * Fotografia aguenta ser exibida acima da resolucao do arquivo muito melhor que texto
 * ou grade de UI — nao ha borda dura para serrilhar. 0,6 e o ponto onde a media de
 * 4096 cobre a tela de celular (que resolve ~5600) sem diferenca perceptivel, e onde
 * ela ja nao cobre a de desktop (que resolve ~9100).
 */
const SUBAMOSTRA_ACEITAVEL = 0.6;

/**
 * Abaixo desta abertura o visitante parou de olhar em volta e passou a inspecionar.
 * E o gatilho da escalada para a completa — ver talvezEscalar().
 */
const FOV_ESCALADA = 45;

/**
 * Avanco na travessia.
 *
 * O panorama nao tem profundidade — e um quad de tela cheia com o raio calculado por
 * pixel a partir de um ponto so — entao nao existe deslocar a camera de verdade. O que
 * o olho le como andar sao duas coisas que cabem dentro do mix que ja existe: a
 * abertura fechando e voltando, que faz a imagem passar por quem olha, e o giro
 * puxando para o lado do ponto acionado. Sem isso a troca e uma dissolucao, que e o
 * que separa slideshow de tour.
 *
 * Feito na camera e nao no shader de proposito. O shader carrega a correcao de
 * derivada na costura e a matriz de raio que serve aos dois olhos do headset — e o
 * lugar do projeto onde erro nao aparece em tela plana. Aqui nao ha nada disso a
 * arriscar por um efeito de meio segundo.
 */
const AVANCO_FOV = 9;
const AVANCO_GIRO = 0.18;

/**
 * Fracao da travessia em que o avanco comeca e termina.
 *
 * O empurrao pertence a saida, nao a chegada: ele acontece nos primeiros 60% e a cena
 * de destino ainda tem os 40% finais do fade para assentar sem movimento nenhum. Com o
 * avanco espalhado pela travessia inteira, o ambiente novo aparece ja em movimento e a
 * chegada fica inquieta.
 */
const AVANCO_JANELA = 0.6;

/** Conexao em que 23 MB e abuso, dita pelo proprio navegador. */
function redeEconomica() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return false;
  return !!c.saveData || c.effectiveType === '2g' || c.effectiveType === 'slow-2g';
}
const PITCH_MAX = (89 * Math.PI) / 180;
const GRAU = Math.PI / 180;

const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

/** Ângulo mais curto entre dois yaws, para a travessia não girar o caminho longo. */
function deltaAngular(de, para) {
  let d = (para - de) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Direção no mundo de um ponto (yaw, pitch) — o mesmo par que centraliza a câmera
 * nele. Deriva de -col2 da matriz de rotação, então projeção e colocação de hotspot
 * usam exatamente a mesma convenção do shader.
 */
export function direcaoDe(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Ry(yaw) · Rx(pitch), em column-major para uniformMatrix3fv. */
function matrizRotacao(yaw, pitch, saida) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  saida[0] = cy;      saida[1] = 0;   saida[2] = -sy;
  saida[3] = sy * sp; saida[4] = cp;  saida[5] = cy * sp;
  saida[6] = sy * cp; saida[7] = -sp; saida[8] = cy * cp;
  return saida;
}

function compilar(gl, tipo, fonte) {
  const s = gl.createShader(tipo);
  gl.shaderSource(s, fonte);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Falha ao compilar shader: ${log}`);
  }
  return s;
}

/**
 * Largura e altura lidas do cabeçalho do JPEG, sem decodificar a imagem.
 *
 * Serve para escolher o tamanho do decode antes dele acontecer. Lê só o começo do
 * arquivo: o marcador SOF vem antes dos dados de varredura, que são o volume todo.
 * Devolve null para PNG e para JPEG cujo cabeçalho não couber na fatia lida — quem
 * chama tem o caminho de duas etapas como reserva.
 */
export async function dimensoesJpeg(blob) {
  const b = new DataView(await blob.slice(0, 128 * 1024).arrayBuffer());
  if (b.byteLength < 4 || b.getUint16(0) !== 0xffd8) return null;
  let i = 2;
  while (i + 9 < b.byteLength) {
    if (b.getUint8(i) !== 0xff) {
      i += 1;
      continue;
    }
    const m = b.getUint8(i + 1);
    // SOF0..SOF15 carregam as dimensões; C4/C8/CC caem nessa faixa e não são SOF.
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { altura: b.getUint16(i + 5), largura: b.getUint16(i + 7) };
    }
    // Marcadores sem carga (RSTn, SOI, EOI) não têm campo de tamanho para pular.
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd9)) {
      i += 2;
      continue;
    }
    i += 2 + b.getUint16(i + 2);
  }
  return null;
}

/**
 * Decodifica um panorama e reduz ao teto de textura do aparelho.
 * Essencial no celular: o iPhone costuma aceitar 4096px e o panorama pode ter 11000.
 * Sem esta redução a textura é recusada e a cena fica preta.
 *
 * O decode já sai no tamanho final quando o cabeçalho revela as dimensões. Isto passou
 * a ser obrigatório quando o panorama guardado deixou de ser reduzido para 8192px (ver
 * imagem.js): decodificar inteiro para reduzir depois faria um bitmap intermediário de
 * 11968x5984, que são 286 MB de RGBA vivos ao mesmo tempo. No desktop passa; num Quest
 * 2 é onde a aba morre, e sem mensagem nenhuma.
 */
async function carregarBitmap(url, tetoTextura, sinal, blobPronto = null) {
  let blob = blobPronto;
  if (!blob) {
    const resposta = await fetch(url, { signal: sinal });
    if (!resposta.ok) throw new Error(`Imagem indisponível (${resposta.status}): ${url}`);
    blob = await resposta.blob();
  }

  const dim = await dimensoesJpeg(blob);
  if (dim && dim.largura > tetoTextura) {
    const altura = Math.round((dim.altura / dim.largura) * tetoTextura);
    try {
      const direto = await createImageBitmap(blob, {
        resizeWidth: tetoTextura,
        resizeHeight: altura,
        resizeQuality: 'high',
      });
      if (direto.width === tetoTextura) return direto;
      direto.close?.();
    } catch {
      /* segue para o caminho de duas etapas */
    }
  }

  let bitmap = await createImageBitmap(blob);
  if (bitmap.width > tetoTextura) {
    const largura = tetoTextura;
    const altura = Math.round((bitmap.height / bitmap.width) * largura);
    const reduzido = await createImageBitmap(bitmap, {
      resizeWidth: largura,
      resizeHeight: altura,
      resizeQuality: 'high',
    });
    bitmap.close();
    bitmap = reduzido;
  }
  return bitmap;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ aoMover?: (camera) => void, dprMax?: number }} opcoes
 */
export function criarPanorama(canvas, opcoes = {}) {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WEBGL2_INDISPONIVEL');

  const aoMover = opcoes.aoMover || (() => {});
  const dprMax = opcoes.dprMax || 2;
  const tetoTextura = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  /**
   * Teto de textura em vigor.
   *
   * Em VR o limite que importa nao e o do driver, e a memoria. Este numero foi 6144
   * enquanto o panorama guardado era um JPEG reduzido a 8192px. Com a original crua em
   * disco (ver imagem.js) 6144 virou o gargalo visivel, e a conta que o justificava
   * estava errada: 6144 rende 1536 px por 90 graus, enquanto o Quest 2 desenha 1832 px
   * por olho em ~89 graus e o Quest 3 desenha 2064 em ~110. O painel resolve mais que
   * a textura, e e por isso que a foto chegava macia no headset.
   *
   * 8192 cobre os dois: o casamento exato pediria 7412 px no Quest 2 e 6754 no Quest 3.
   * Custa 128 MiB, ~171 MiB com mipmap.
   *
   * O pico da travessia soma a isso a PREVIA, nao um segundo panorama completo: em
   * carregar() a previa de 1536px entra primeiro e e ela que ocupa a outra ponta do
   * fade, ~6 MiB. Por isso a previa nao e opcional aqui — sem ela o fade passa a cruzar
   * dois panoramas inteiros e o pico dobra.
   *
   * Se o headset morrer numa cena, este e o numero para baixar.
   */
  const tetoAtual = () => (estado.xr ? Math.min(tetoTextura, 8192) : tetoTextura);

  // Anisotropia importa muito aqui: ripa de brise e régua de painel são linhas
  // paralelas finas em ângulo raso, o pior caso possível para filtragem isotrópica.
  const extAniso =
    gl.getExtension('EXT_texture_filter_anisotropic') ||
    gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  const anisoMax = extAniso ? Math.min(8, gl.getParameter(extAniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 0;

  const programa = gl.createProgram();
  gl.attachShader(programa, compilar(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(programa, compilar(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(programa);
  if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) {
    throw new Error(`Falha ao linkar programa: ${gl.getProgramInfoLog(programa)}`);
  }
  gl.useProgram(programa);

  const u = {
    raio: gl.getUniformLocation(programa, 'uRaio'),
    texA: gl.getUniformLocation(programa, 'uTexA'),
    texB: gl.getUniformLocation(programa, 'uTexB'),
    mix: gl.getUniformLocation(programa, 'uMix'),
  };
  gl.uniform1i(u.texA, 0);
  gl.uniform1i(u.texB, 1);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(programa, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  /**
   * uRaio = R · diag(tanX, tanY, -1) — cada coluna da rotacao escalada.
   * Equivale exatamente a formulacao anterior, para o caminho de tela plana.
   */
  function raioDeTela(rotacao, tanX, tanY, saida) {
    for (let i = 0; i < 3; i++) {
      saida[i] = rotacao[i] * tanX;
      saida[3 + i] = rotacao[3 + i] * tanY;
      saida[6 + i] = -rotacao[6 + i];
    }
    return saida;
  }

  /**
   * uRaio = R · P⁻¹ para um olho do headset.
   *
   * P⁻¹ da direcao em espaco de vista a partir do NDC: com z_vista = -1,
   * x_vista = (ndc.x - P02) / P00 e y_vista = (ndc.y - P12) / P11. Os termos P02 e P12
   * sao justamente o deslocamento do centro optico — o que torna o frustum assimetrico
   * e o que a formulacao antiga nao sabia representar.
   *
   * A translacao da cabeca e ignorada de proposito: a foto 360 esta no infinito, entao
   * so a rotacao muda a imagem. E por isso que o panorama monoscopico nao acompanha
   * quem anda pela sala, e nao ha o que fazer a respeito sem foto volumetrica.
   */
  function raioDeVista(projecao, transformada, giroMundo, saida) {
    const p00 = projecao[0];
    const p11 = projecao[5];
    const p02 = projecao[8];
    const p12 = projecao[9];

    // Rotacao vista→mundo: 3x3 superior de transformada, ja em column-major.
    const r = [
      transformada[0], transformada[1], transformada[2],
      transformada[4], transformada[5], transformada[6],
      transformada[8], transformada[9], transformada[10],
    ];

    // clip.x = P00·vx + P02·vz e clip.w = -vz. Com vz = -1: ndc.x = P00·vx - P02,
    // logo vx = (ndc.x + P02) / P00 — o deslocamento entra SOMANDO.
    //
    // Este sinal é invisível em tela plana, onde o frustum é simétrico e P02 = 0. Só
    // aparece no headset, onde cada olho tem o centro óptico deslocado para um lado:
    // com o sinal trocado as duas imagens se afastam em direções opostas, com o dobro
    // do erro, e o cérebro não consegue fundir.
    const sx = 1 / p00;
    const sy = 1 / p11;
    const ox = p02 / p00;
    const oy = p12 / p11;

    const m = new Array(9);
    for (let i = 0; i < 3; i++) {
      m[i] = r[i] * sx;
      m[3 + i] = r[3 + i] * sy;
      m[6 + i] = r[i] * ox + r[3 + i] * oy - r[6 + i];
    }

    // Alinhamento da cena: gira o mundo em torno de Y para que a vista de entrada da
    // cena caia à frente de onde a pessoa já está olhando.
    const c = Math.cos(giroMundo);
    const s = Math.sin(giroMundo);
    for (let col = 0; col < 3; col++) {
      const x = m[col * 3];
      const z = m[col * 3 + 2];
      saida[col * 3] = c * x + s * z;
      saida[col * 3 + 1] = m[col * 3 + 1];
      saida[col * 3 + 2] = -s * x + c * z;
    }
    return saida;
  }

  const estado = {
    camera: { yaw: 0, pitch: 0, fov: FOV_PADRAO },
    texA: null,
    texB: null,
    mix: 0,
    largura: 1,
    altura: 1,
    destruido: false,
    aguardando: false,
    animando: null,
    inercia: { yaw: 0, pitch: 0, t: 0 },
    gyro: null,
    carregamento: null,
    /**
     * Quando a cena corrente esta sendo exibida pela derivada de tela, guarda o que
     * seria preciso para trocar pela completa. null quando ja e a completa.
     */
    escalada: null,
    /** AbortController do pre-carregamento do vizinho, ou null. */
    prefetch: null,
    /** Sessao WebXR ativa. Enquanto existe, desenhar() se cala: o laco e outro. */
    xr: null,
  };

  /**
   * Blobs do vizinho ja baixados, por URL.
   *
   * Guardar o blob em vez de confiar no cache HTTP, por duas razoes. Em
   * desenvolvimento o servidor manda `no-store` em /media/, entao um pre-carregamento
   * apoiado no cache do navegador nao teria efeito nenhum — e o criterio de "a
   * travessia nao dispara requisicao nova" seria impossivel de conferir justo na
   * maquina onde o tour e montado. E porque o limite aqui e memoria, e nao disco:
   * segurar no maximo um panorama pesado e uma decisao que o cache do navegador nao
   * deixa tomar.
   *
   * Consumo e destrutivo: quem usa o blob tira do mapa, para o proximo carregamento
   * nao continuar segurando 20 MB por nada.
   */
  const blobsProntos = new Map();
  const tomarBlob = (url) => {
    const b = blobsProntos.get(url);
    if (b) blobsProntos.delete(url);
    return b || null;
  };
  const rot = new Float32Array(9);
  const raio = new Float32Array(9);

  // ── textura ───────────────────────────────────────────────────────────────

  function criarTextura(bitmap) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    // horizontal dá a volta; vertical trava na borda, senão o zênite sangra no nadir
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (anisoMax) gl.texParameterf(gl.TEXTURE_2D, extAniso.TEXTURE_MAX_ANISOTROPY_EXT, anisoMax);
    return tex;
  }

  function descartar(tex) {
    if (tex) gl.deleteTexture(tex);
  }

  // ── desenho ───────────────────────────────────────────────────────────────

  function dimensionar() {
    const dpr = Math.min(window.devicePixelRatio || 1, dprMax);
    const l = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const a = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (l === estado.largura && a === estado.altura) return false;
    canvas.width = l;
    canvas.height = a;
    estado.largura = l;
    estado.altura = a;
    gl.viewport(0, 0, l, a);
    return true;
  }

  /**
   * Meia-abertura em tangente, horizontal e vertical.
   *
   * Usa o tamanho CSS, não o do buffer de desenho: o buffer só é medido dentro de
   * desenhar(), que desiste cedo enquanto não há textura. Ler dali deixaria a
   * proporção velha entre um resize e o quadro seguinte — e como projetar(), doEcra()
   * e o arrasto todos dependem disto, o hotspot cairia longe do ponto clicado.
   */
  function tangentes() {
    const proporcao = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
    const tanY = Math.tan((estado.camera.fov * GRAU) / 2);
    return [tanY * proporcao, tanY];
  }

  /** Amarra texturas e mix; comum aos dois caminhos de desenho. */
  function prepararPasse() {
    gl.useProgram(programa);
    gl.bindVertexArray(vao);
    gl.uniform1f(u.mix, estado.texB ? estado.mix : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, estado.texA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, estado.texB || estado.texA);
  }

  function desenhar() {
    if (estado.destruido || !estado.texA || estado.xr) return;
    dimensionar();
    const [tanX, tanY] = tangentes();

    prepararPasse();
    gl.uniformMatrix3fv(
      u.raio,
      false,
      raioDeTela(matrizRotacao(estado.camera.yaw, estado.camera.pitch, rot), tanX, tanY, raio),
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Desenha o panorama para um olho, no viewport que o WebXR indicou.
   * Quem chama e o laco da sessao, em vr.js — nao ha requestAnimationFrame de janela
   * dentro de uma sessao imersiva.
   */
  function desenharVista(vista, viewport, giroMundo) {
    if (estado.destruido || !estado.texA) return;
    // O recorte por olho é responsabilidade de quem chama (vr.js liga o SCISSOR_TEST):
    // este triângulo cobre muito mais que o viewport e invadiria o outro olho.
    gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
    prepararPasse();
    gl.uniformMatrix3fv(
      u.raio,
      false,
      raioDeVista(vista.projectionMatrix, vista.transform.matrix, giroMundo, raio),
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Desenha no próximo quadro. Fora de animação o canvas fica parado — não queima bateria. */
  function pedirQuadro() {
    if (estado.aguardando || estado.destruido) return;
    estado.aguardando = true;
    requestAnimationFrame(() => {
      estado.aguardando = false;
      desenhar();
      aoMover(publico.camera);
    });
  }

  // ── animação ──────────────────────────────────────────────────────────────

  const suave = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function animar(passo, duracao, aoFim) {
    encerrarAnimacao();
    const inicio = performance.now();
    const quadro = (agora) => {
      if (estado.destruido) return;
      const t = Math.min(1, (agora - inicio) / duracao);
      passo(suave(t), t);
      desenhar();
      aoMover(publico.camera);
      if (t < 1) {
        estado.animando.id = requestAnimationFrame(quadro);
      } else {
        estado.animando = null;
        if (aoFim) aoFim();
      }
    };
    estado.animando = { id: requestAnimationFrame(quadro), aoFim };
  }

  /**
   * Interrompe a animação corrente executando o aoFim dela.
   *
   * Executar é o ponto: o aoFim de uma travessia é o que resolve a promise de
   * carregar() e comita a textura nova. Só cancelar o quadro deixaria essa promise
   * pendurada para sempre — e o tour público, que serializa o carregamento, ficaria
   * preso sem conseguir trocar de ambiente outra vez.
   */
  function encerrarAnimacao() {
    if (!estado.animando) return;
    const { id, aoFim } = estado.animando;
    cancelAnimationFrame(id);
    estado.animando = null;
    if (aoFim) aoFim();
  }

  // ── carregamento de cena ──────────────────────────────────────────────────

  /**
   * Largura de textura que ESTA tela de fato resolve, no enquadramento dado.
   *
   * A textura cobre 360 graus; na tela aparece uma fatia de `fov` graus esticada sobre
   * a largura do canvas em pixels de aparelho. Para cada pixel receber o seu texel, a
   * textura precisa de 360/fov vezes essa largura. Num iPhone (393 css x DPR 3) dá
   * ~5600 px no padrao de 76 graus, e ~15200 no zoom maximo de 28.
   */
  function larguraResolvida(fov = FOV_PADRAO) {
    const dpr = Math.min(window.devicePixelRatio || 1, dprMax);
    const larguraCss = canvas.clientWidth || window.innerWidth || 1;
    return (360 / fov) * larguraCss * dpr;
  }

  /**
   * Qual arquivo buscar: a derivada de tela ou a completa.
   *
   * O sinal NAO e MAX_TEXTURE_SIZE. Aquilo e um limite de driver — um iPhone reporta
   * 16384 e continua tendo 1180 px de tela — e escolher por ele mandaria os 23 MB
   * justo para o aparelho onde a derivada existe para ajudar. Os dois sinais que
   * decidem sao o que a tela resolve e o que a rede cobra.
   *
   * Em VR a resposta e sempre a completa: o que o cliente ve no headset tem que ser a
   * foto do equipamento. La o limite e memoria, e quem cuida disso e tetoAtual().
   */
  function escolherFonte(fontes) {
    if (!fontes.media || estado.xr) return { url: fontes.completa, ehMedia: false };
    if (redeEconomica()) return { url: fontes.media, ehMedia: true };
    const basta = LARGURA_MEDIA >= larguraResolvida() * SUBAMOSTRA_ACEITAVEL;
    return basta
      ? { url: fontes.media, ehMedia: true }
      : { url: fontes.completa, ehMedia: false };
  }

  /**
   * Comita uma textura mais nítida por cima da que está na tela.
   *
   * Igual ao fade de nitidez de carregar(), com uma diferença: dentro da sessão
   * imersiva o rAF da página pode não correr, e um fade dali ficaria preso no meio,
   * com o mix parado num valor qualquer. Ali a troca é seca.
   */
  function comitarNitidez(bitmap) {
    const nova = criarTextura(bitmap);
    bitmap.close?.();
    if (!estado.texA) {
      descartar(nova);
      return Promise.resolve();
    }
    if (estado.xr) {
      descartar(estado.texA);
      descartar(estado.texB);
      estado.texA = nova;
      estado.texB = null;
      estado.mix = 0;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      descartar(estado.texB);
      estado.texB = nova;
      estado.mix = 0;
      animar(
        (p) => { estado.mix = p; },
        180,
        () => {
          descartar(estado.texA);
          estado.texA = estado.texB;
          estado.texB = null;
          estado.mix = 0;
          desenhar();
          resolve();
        },
      );
    });
  }

  /**
   * O visitante aproximou de verdade: busca a completa e troca.
   *
   * A derivada de tela entrega 0,73 do que o celular resolve no enquadramento padrão,
   * o que não se enxerga. No zoom máximo ela cai para 0,27 e a ripa do brise amacia —
   * e é exatamente aí que alguém está olhando a ripa do brise. Então a completa entra
   * sob demanda: quem só percorreu a obra nunca paga pelos 23 MB, e quem foi conferir
   * a especificação recebe a foto da câmera.
   *
   * `forcar` é a entrada em VR, onde a regra não é o enquadramento e sim a promessa de
   * que no headset o cliente vê o arquivo do equipamento.
   */
  async function talvezEscalar({ forcar = false } = {}) {
    const e = estado.escalada;
    if (!e || e.emCurso) return;
    if (!forcar && (estado.camera.fov > FOV_ESCALADA || redeEconomica())) return;
    e.emCurso = true;

    try {
      const bitmap = await carregarBitmap(e.completa, tetoAtual(), e.sinal);
      // A cena pode ter trocado enquanto a completa vinha: a textura nova seria de
      // outro ambiente. O sinal cobre o caso comum; a comparação cobre a corrida.
      if (e.sinal.aborted || estado.escalada !== e) {
        bitmap.close?.();
        return;
      }
      estado.escalada = null;
      await comitarNitidez(bitmap);
    } catch {
      // Escalada é luxo. Falhou, o visitante continua com a derivada de tela — que é
      // o que ele já estava vendo. Não há nada a dizer na tela.
      e.emCurso = false;
    }
  }

  // ── pré-carregamento do vizinho ───────────────────────────────────────────

  /** Interrompe o que estiver baixando em segundo plano. Não descarta o que já veio. */
  function cancelarPrefetch() {
    estado.prefetch?.abort();
    estado.prefetch = null;
  }

  async function guardarBlob(url, sinal) {
    if (blobsProntos.has(url)) return;
    try {
      const r = await fetch(url, { signal: sinal });
      if (!r.ok || sinal.aborted) return;
      const blob = await r.blob();
      if (sinal.aborted) return;
      blobsProntos.set(url, blob);
    } catch {
      // Pré-carregamento é luxo: falhou, a travessia busca na hora, como sempre fez.
    }
  }

  /**
   * Baixa em segundo plano o que a próxima travessia vai pedir.
   *
   * Hoje toda troca de ambiente começa do zero, mesmo com o grafo de passagens
   * inteiro conhecido desde que a cena carregou. Aqui a prévia de cada destino direto
   * (~150 KB) vem para todos, e a derivada de tela — pesada — só do primeiro.
   *
   * Três recusas explícitas:
   *  - dentro do headset, porque ali prefetch e o teto de 8192 disputam a mesma
   *    memória, e a memória é o limite que derruba a cena sem aviso;
   *  - em rede econômica, onde baixar o que talvez não seja visto é abuso;
   *  - antes do ocioso, para o vizinho não competir com a cena que está na tela.
   *
   * @param {Array<{previa?:string, media?:string, completa:string}>} destinos
   */
  function preCarregar(destinos) {
    cancelarPrefetch();
    blobsProntos.clear();
    if (estado.xr || !Array.isArray(destinos) || !destinos.length) return;

    const controlador = new AbortController();
    const sinal = controlador.signal;
    estado.prefetch = controlador;
    const economica = redeEconomica();

    const noOcioso = window.requestIdleCallback
      ? (fn) => window.requestIdleCallback(fn, { timeout: 2000 })
      : (fn) => setTimeout(fn, 400);

    noOcioso(async () => {
      if (sinal.aborted) return;
      for (const d of destinos) {
        if (sinal.aborted) return;
        if (d.previa) await guardarBlob(d.previa, sinal);
      }
      // A pesada é só do primeiro destino: adivinhar dois é dobrar a aposta com o
      // dobro do custo, e a taxa de acerto não dobra junto.
      if (!economica && !sinal.aborted && destinos[0]) {
        await guardarBlob(escolherFonte(destinos[0]).url, sinal);
      }
    });
  }

  /**
   * Carrega uma cena. `previa` (1536px, ~150 KB) entra primeiro para o ambiente
   * aparecer quase imediatamente; quando a de tela chega, ela substitui a prévia
   * num fade curto — a imagem ganha nitidez em vez de piscar.
   *
   * @param {{previa?:string, media?:string, completa:string}} fontes
   * @param {{yaw:number,pitch:number,fov:number}} [vista]
   * @param {{travessia?:boolean, deHotspot?:{yaw:number,pitch:number}}} [opcoes]
   */
  async function carregar(fontes, vista, { travessia = false, deHotspot = null } = {}) {
    estado.carregamento?.abort();
    const controlador = new AbortController();
    estado.carregamento = controlador;
    const sinal = controlador.signal;
    estado.escalada = null;
    // O que estiver vindo do vizinho perdeu o sentido: o vizinho e outro agora.
    cancelarPrefetch();

    const aplicarVista = () => {
      if (!vista) return;
      // Guardada tambem para o VR, que precisa do yaw pretendido da cena para
      // alinhar o mundo com a direcao em que a cabeca ja esta.
      estado.vistaCena = { yaw: vista.yaw ?? 0, pitch: vista.pitch ?? 0 };
      estado.camera.yaw = vista.yaw ?? 0;
      estado.camera.pitch = limitar(vista.pitch ?? 0, -PITCH_MAX, PITCH_MAX);
      estado.camera.fov = limitar(vista.fov ?? FOV_PADRAO, FOV_MIN, FOV_MAX);
    };

    const trocar = (bitmap, comFade) =>
      new Promise((resolve) => {
        const nova = criarTextura(bitmap);
        bitmap.close?.();

        if (!estado.texA || !comFade) {
          descartar(estado.texA);
          descartar(estado.texB);
          estado.texA = nova;
          estado.texB = null;
          estado.mix = 0;
          aplicarVista();
          desenhar();
          resolve();
          return;
        }

        descartar(estado.texB);
        estado.texB = nova;
        estado.mix = 0;

        // Dentro do headset o avanco e nulo: ali a camera e a cabeca de quem esta
        // usando, e movimento nao solicitado causa desconforto. Se um dia for medido
        // no Quest e valer a pena, o numero a levantar de zero e AVANCO_FOV.
        const avanca = comFade === 'cena' && deHotspot && !estado.xr;
        const duracao = comFade === 'cena' ? (avanca ? 520 : 420) : 180;

        // Numa travessia a câmera caminha até a vista da cena de destino enquanto
        // a imagem cruza. Chegar já apontando para o lugar certo evita o solavanco
        // de aparecer olhando para uma parede.
        const de = { ...estado.camera };
        const alvo = comFade === 'cena' && vista
          ? {
              yaw: de.yaw + deltaAngular(de.yaw, vista.yaw ?? 0),
              pitch: limitar(vista.pitch ?? 0, -PITCH_MAX, PITCH_MAX),
              fov: limitar(vista.fov ?? FOV_PADRAO, FOV_MIN, FOV_MAX),
            }
          : null;

        // Quanto girar para o lado do ponto acionado, medido uma vez: dentro do laco
        // a camera ja mudou e o angulo encolheria a cada quadro.
        const guinada = avanca && alvo ? deltaAngular(de.yaw, deHotspot.yaw) : 0;
        const inclinada = avanca && alvo ? (deHotspot.pitch ?? 0) - de.pitch : 0;
        const somado = { yaw: 0, pitch: 0, fov: 0 };

        animar(
          (p) => {
            estado.mix = p;
            if (alvo) {
              // Meio seno dentro da janela: sai de zero, chega ao pico e volta a zero
              // antes do fim, para o avanco nao deixar a camera torta ao chegar.
              const empurrao = avanca ? Math.sin(Math.min(p / AVANCO_JANELA, 1) * Math.PI) : 0;
              somado.yaw = guinada * AVANCO_GIRO * empurrao;
              somado.pitch = inclinada * AVANCO_GIRO * empurrao;
              somado.fov = -AVANCO_FOV * empurrao;

              estado.camera.yaw = de.yaw + (alvo.yaw - de.yaw) * p + somado.yaw;
              estado.camera.pitch = limitar(
                de.pitch + (alvo.pitch - de.pitch) * p + somado.pitch,
                -PITCH_MAX,
                PITCH_MAX,
              );
              estado.camera.fov = limitar(
                de.fov + (alvo.fov - de.fov) * p + somado.fov,
                FOV_MIN,
                FOV_MAX,
              );
            }
          },
          duracao,
          () => {
            // O avanco e transitorio, e no caminho normal ele ja voltou a zero antes
            // daqui. O que este bloco cobre e a travessia interrompida: a mao do
            // visitante no panorama, ou outra cena pedida no meio do fade. Nesses
            // casos encerrarAnimacao() chama este aoFim com o empurrao ainda somado,
            // e sem desfaze-lo a cena ficaria parada num enquadramento que ninguem
            // pediu — alguns graus fechada, alguns graus torta.
            if (somado.yaw || somado.pitch || somado.fov) {
              estado.camera.yaw -= somado.yaw;
              estado.camera.pitch = limitar(estado.camera.pitch - somado.pitch, -PITCH_MAX, PITCH_MAX);
              estado.camera.fov = limitar(estado.camera.fov - somado.fov, FOV_MIN, FOV_MAX);
              somado.yaw = 0;
              somado.pitch = 0;
              somado.fov = 0;
            }
            // Fecha a vista de entrada no valor exato.
            //
            // A interpolacao ja chega la quando a animacao corre inteira, mas so ate o
            // arredondamento do ultimo quadro — e agora esse residuo e copiavel dentro
            // do link, porque o endereco por vista grava tres casas. Numa travessia
            // interrompida a diferenca deixa de ser residuo e vira graus.
            //
            // Com o dedo no panorama nao se mexe: quem interrompeu a travessia de
            // proposito esta olhando para onde quer, e puxar a camera dali seria pior
            // que a diferenca que isto corrige.
            if (alvo && !ponteiros.size) Object.assign(estado.camera, alvo);
            descartar(estado.texA);
            estado.texA = estado.texB;
            estado.texB = null;
            estado.mix = 0;
            desenhar();
            resolve();
          },
        );
      });

    if (fontes.previa) {
      try {
        const bitmap = await carregarBitmap(fontes.previa, tetoAtual(), sinal, tomarBlob(fontes.previa));
        if (sinal.aborted) return;
        await trocar(bitmap, travessia ? 'cena' : false);
      } catch (e) {
        if (e.name === 'AbortError') return;
        // Prévia é otimização: se faltar, segue direto para a completa.
      }
    }

    const escolha = escolherFonte(fontes);
    const bitmap = await carregarBitmap(escolha.url, tetoAtual(), sinal, tomarBlob(escolha.url));
    if (sinal.aborted) {
      bitmap.close?.();
      return;
    }
    await trocar(bitmap, fontes.previa ? 'nitidez' : travessia ? 'cena' : false);

    if (escolha.ehMedia) {
      estado.escalada = { completa: fontes.completa, sinal, emCurso: false };
      // Link compartilhado pode chegar já apontando de perto: a escalada não pode
      // depender de o visitante mexer no zoom depois.
      talvezEscalar();
    }
  }

  // ── projeção ──────────────────────────────────────────────────────────────

  /** (yaw,pitch) → pixel CSS no canvas. `visivel:false` quando está atrás da câmera. */
  function projetar(yaw, pitch) {
    const d = direcaoDe(yaw, pitch);
    const m = matrizRotacao(estado.camera.yaw, estado.camera.pitch, rot);
    // transposta = inversa, para levar do mundo ao espaço da câmera
    const cx = m[0] * d.x + m[1] * d.y + m[2] * d.z;
    const cy = m[3] * d.x + m[4] * d.y + m[5] * d.z;
    const cz = m[6] * d.x + m[7] * d.y + m[8] * d.z;

    if (cz >= -1e-6) return { x: 0, y: 0, visivel: false };

    const [tanX, tanY] = tangentes();
    const ndcX = cx / -cz / tanX;
    const ndcY = cy / -cz / tanY;
    const l = canvas.clientWidth;
    const a = canvas.clientHeight;
    return {
      x: (ndcX * 0.5 + 0.5) * l,
      y: (1 - (ndcY * 0.5 + 0.5)) * a,
      // margem generosa: um hotspot meio fora da tela some sem cortar pela metade
      visivel: ndcX > -1.6 && ndcX < 1.6 && ndcY > -1.6 && ndcY < 1.6,
    };
  }

  /** Pixel CSS no canvas → (yaw,pitch). É o inverso exato de projetar(). */
  function doEcra(px, py) {
    const l = canvas.clientWidth;
    const a = canvas.clientHeight;
    const [tanX, tanY] = tangentes();
    const ndcX = (px / l) * 2 - 1;
    const ndcY = 1 - (py / a) * 2;

    let dx = ndcX * tanX;
    let dy = ndcY * tanY;
    let dz = -1;
    const n = Math.hypot(dx, dy, dz);
    dx /= n; dy /= n; dz /= n;

    const m = matrizRotacao(estado.camera.yaw, estado.camera.pitch, rot);
    const wx = m[0] * dx + m[3] * dy + m[6] * dz;
    const wy = m[1] * dx + m[4] * dy + m[7] * dz;
    const wz = m[2] * dx + m[5] * dy + m[8] * dz;

    return {
      yaw: Math.atan2(-wx, -wz),
      pitch: Math.asin(limitar(wy, -1, 1)),
    };
  }

  // ── câmera ────────────────────────────────────────────────────────────────

  function definirCamera({ yaw, pitch, fov }, { animado = false } = {}) {
    const alvo = {
      yaw: yaw ?? estado.camera.yaw,
      pitch: limitar(pitch ?? estado.camera.pitch, -PITCH_MAX, PITCH_MAX),
      fov: limitar(fov ?? estado.camera.fov, FOV_MIN, FOV_MAX),
    };
    if (!animado) {
      Object.assign(estado.camera, alvo);
      pedirQuadro();
      return;
    }
    const de = { ...estado.camera };
    const dYaw = deltaAngular(de.yaw, alvo.yaw);
    animar((p) => {
      estado.camera.yaw = de.yaw + dYaw * p;
      estado.camera.pitch = de.pitch + (alvo.pitch - de.pitch) * p;
      estado.camera.fov = de.fov + (alvo.fov - de.fov) * p;
    }, 340);
  }

  /** Arrasto em pixels → deslocamento angular, na escala do fov atual (1:1 na tela). */
  function girarPorPixels(dx, dy) {
    const [tanX, tanY] = tangentes();
    const l = canvas.clientWidth || 1;
    const a = canvas.clientHeight || 1;
    estado.camera.yaw += (dx / l) * 2 * Math.atan(tanX);
    estado.camera.pitch = limitar(
      estado.camera.pitch - (dy / a) * 2 * Math.atan(tanY),
      -PITCH_MAX,
      PITCH_MAX,
    );
  }

  function zoom(fator) {
    estado.camera.fov = limitar(estado.camera.fov * fator, FOV_MIN, FOV_MAX);
    talvezEscalar();
    pedirQuadro();
  }

  // ── giroscópio ────────────────────────────────────────────────────────────

  /**
   * Orientação do aparelho → yaw/pitch, pelo caminho canônico: quaternion do
   * euler ZXY do sensor, corrigido em 90° porque o referencial do sensor tem o eixo
   * apontando para cima e a câmera olha para o horizonte, e depois compensado pela
   * rotação da tela. Aproximar isso com beta/alpha direto dá deriva no retrato.
   */
  function quaternionDoSensor(alpha, beta, gamma, telaGraus) {
    const z = alpha * GRAU, x = beta * GRAU, y = gamma * GRAU;
    const cX = Math.cos(x / 2), cY = Math.cos(y / 2), cZ = Math.cos(z / 2);
    const sX = Math.sin(x / 2), sY = Math.sin(y / 2), sZ = Math.sin(z / 2);

    // euler YXZ
    let q = [
      sX * cY * cZ + cX * sY * sZ,
      cX * sY * cZ - sX * cY * sZ,
      cX * cY * sZ - sX * sY * cZ,
      cX * cY * cZ + sX * sY * sZ,
    ];

    const mult = (a, b) => [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];

    const meio = Math.sin(-Math.PI / 4);
    q = mult(q, [meio, 0, 0, Math.cos(-Math.PI / 4)]);
    const t = -telaGraus * GRAU;
    q = mult(q, [0, 0, Math.sin(t / 2), Math.cos(t / 2)]);
    return q;
  }

  function aplicarGyro(evento) {
    if (evento.alpha == null) return;
    const telaGraus = screen.orientation?.angle ?? window.orientation ?? 0;
    const [qx, qy, qz, qw] = quaternionDoSensor(evento.alpha, evento.beta, evento.gamma, telaGraus);

    // roda (0,0,-1) pelo quaternion
    const vx = 0, vy = 0, vz = -1;
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    const wx = vx + qw * tx + (qy * tz - qz * ty);
    const wy = vy + qw * ty + (qz * tx - qx * tz);
    const wz = vz + qw * tz + (qx * ty - qy * tx);

    estado.camera.yaw = Math.atan2(-wx, -wz);
    estado.camera.pitch = limitar(Math.asin(limitar(wy, -1, 1)), -PITCH_MAX, PITCH_MAX);
    pedirQuadro();
  }

  /**
   * Ligar o giroscopio nao e so registrar o ouvinte.
   *
   * Em contexto nao seguro — http num IP de rede, por exemplo — o Chrome do Android
   * mantem DeviceOrientationEvent no objeto global e simplesmente nunca dispara o
   * evento. Registrar e devolver sucesso acenderia o botao com a cena imovel, que e
   * o pior desfecho: parece ter funcionado. Aqui se espera o primeiro evento util
   * chegar antes de dar a ligacao por boa.
   *
   * Devolve { ok } ou { ok:false, motivo } para quem chamou poder explicar a razao.
   */
  async function ligarGyro() {
    if (estado.gyro) return { ok: true };

    // Contexto inseguro se verifica ANTES da existencia da API: o Chrome remove
    // DeviceOrientationEvent do objeto global fora de contexto seguro, entao a
    // ausencia dela ali e consequencia do http, nao falta de sensor. Culpar o
    // aparelho seria mentira.
    if (!window.isSecureContext) return { ok: false, motivo: 'inseguro' };
    const Evt = window.DeviceOrientationEvent;
    if (!Evt) return { ok: false, motivo: 'inexistente' };

    if (typeof Evt.requestPermission === 'function') {
      try {
        if ((await Evt.requestPermission()) !== 'granted') return { ok: false, motivo: 'negado' };
      } catch {
        return { ok: false, motivo: 'negado' };
      }
    }

    const chegou = await new Promise((resolve) => {
      const sonda = (e) => {
        // Aparelho sem sensor entrega o evento com os tres eixos nulos.
        if (e.alpha === null && e.beta === null && e.gamma === null) return;
        encerrar(true);
      };
      const encerrar = (valor) => {
        clearTimeout(prazo);
        window.removeEventListener('deviceorientation', sonda, true);
        resolve(valor);
      };
      const prazo = setTimeout(() => encerrar(false), 1200);
      window.addEventListener('deviceorientation', sonda, true);
    });

    if (!chegou) return { ok: false, motivo: 'sem-sinal' };
    if (estado.destruido) return { ok: false, motivo: 'sem-sinal' };

    estado.gyro = aplicarGyro;
    window.addEventListener('deviceorientation', estado.gyro, true);
    return { ok: true };
  }

  function desligarGyro() {
    if (!estado.gyro) return;
    window.removeEventListener('deviceorientation', estado.gyro, true);
    estado.gyro = null;
  }

  // ── interação ─────────────────────────────────────────────────────────────

  const ponteiros = new Map();
  let arrastando = false;
  let ultimo = null;
  let pinca = 0;
  let moveu = 0;

  /**
   * Parâmetros da inércia. A velocidade é estimada em px/ms e precisa das três
   * salvaguardas: `dt` mínimo porque dois eventos podem chegar no mesmo milissegundo
   * e a divisão explodir; média móvel porque o último delta sozinho é ruído; e teto
   * porque um lance rápido geraria centenas de graus de giro depois de soltar.
   */
  const DT_MIN = 6;
  const VEL_MAX = 2.2;
  const PAUSA_MAX = 90;
  const SUAVIZA = 0.35;
  /** Abaixo disto o gesto ainda é clique: um toque para abrir um hotspot não pode
      deslocar a cena, e no editor o ponto tem que cair exatamente onde se clicou. */
  const LIMIAR_ARRASTO = 5;
  /** Piso de velocidade para deslizar: abaixo disto o gesto foi um ajuste fino, e
      continuar girando depois de soltar seria a cena escapando da mão. */
  const VEL_MIN = 0.25;

  function aoDescer(e) {
    if (e.button != null && e.button !== 0 && e.pointerType === 'mouse') return;
    canvas.setPointerCapture?.(e.pointerId);
    ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    encerrarAnimacao();
    estado.inercia.yaw = 0;
    estado.inercia.pitch = 0;
    estado.inercia.t = 0;
    moveu = 0;
    if (ponteiros.size === 1) {
      arrastando = true;
      ultimo = { x: e.clientX, y: e.clientY, t: performance.now() };
      canvas.style.cursor = 'grabbing';
    } else if (ponteiros.size === 2) {
      const [a, b] = [...ponteiros.values()];
      pinca = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  function aoMoverPonteiro(e) {
    if (!ponteiros.has(e.pointerId)) return;
    ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (ponteiros.size >= 2) {
      const [a, b] = [...ponteiros.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinca > 0 && d > 0) zoom(pinca / d);
      pinca = d;
      return;
    }
    if (!arrastando || !ultimo) return;

    const dx = e.clientX - ultimo.x;
    const dy = e.clientY - ultimo.y;
    const agora = performance.now();
    const tAnterior = ultimo.t;
    moveu += Math.abs(dx) + Math.abs(dy);
    ultimo = { x: e.clientX, y: e.clientY, t: agora };
    if (moveu <= LIMIAR_ARRASTO) return;

    const dt = Math.max(DT_MIN, agora - tAnterior);
    estado.inercia.yaw = estado.inercia.yaw * (1 - SUAVIZA) + (dx / dt) * SUAVIZA;
    estado.inercia.pitch = estado.inercia.pitch * (1 - SUAVIZA) + (dy / dt) * SUAVIZA;
    estado.inercia.t = agora;

    girarPorPixels(dx, dy);
    pedirQuadro();
  }

  function aoSubir(e) {
    ponteiros.delete(e.pointerId);
    canvas.releasePointerCapture?.(e.pointerId);
    if (ponteiros.size < 2) pinca = 0;
    if (ponteiros.size > 0) return;

    arrastando = false;
    canvas.style.cursor = '';

    // Inércia curta e amortecida. A marca pede movimento contido: desliza e para,
    // sem quicar e sem girar sozinho.
    // Soltar depois de uma pausa é intenção de parar ali, não de arremessar a cena.
    if (performance.now() - (estado.inercia.t || 0) > PAUSA_MAX) return;

    const vx = limitar(estado.inercia.yaw, -VEL_MAX, VEL_MAX);
    const vy = limitar(estado.inercia.pitch, -VEL_MAX, VEL_MAX);
    if (Math.hypot(vx, vy) < VEL_MIN) return;

    const px = vx * 170;
    const py = vy * 170;
    let anterior = 0;
    animar((p) => {
      const passo = p - anterior;
      anterior = p;
      girarPorPixels(px * passo, py * passo);
    }, 620);
  }

  function aoRolar(e) {
    e.preventDefault();
    const passo = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaY;
    zoom(Math.exp(limitar(passo, -240, 240) * 0.0014));
  }

  function aoTeclar(e) {
    const passoAngular = canvas.clientWidth / 12;
    const acoes = {
      ArrowLeft: () => girarPorPixels(passoAngular, 0),
      ArrowRight: () => girarPorPixels(-passoAngular, 0),
      ArrowUp: () => girarPorPixels(0, -passoAngular / 2),
      ArrowDown: () => girarPorPixels(0, passoAngular / 2),
      '+': () => zoom(0.86),
      '=': () => zoom(0.86),
      '-': () => zoom(1.16),
      _: () => zoom(1.16),
    };
    const acao = acoes[e.key];
    if (!acao) return;
    e.preventDefault();
    encerrarAnimacao();
    acao();
    pedirQuadro();
  }

  canvas.addEventListener('pointerdown', aoDescer);
  canvas.addEventListener('pointermove', aoMoverPonteiro);
  canvas.addEventListener('pointerup', aoSubir);
  canvas.addEventListener('pointercancel', aoSubir);
  canvas.addEventListener('wheel', aoRolar, { passive: false });
  canvas.addEventListener('keydown', aoTeclar);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // pedirQuadro() sempre dispara aoMover, e é por ali que a camada de hotspots
  // se reposiciona depois de o palco mudar de tamanho
  const observador = new ResizeObserver(() => {
    dimensionar();
    pedirQuadro();
  });
  observador.observe(canvas);

  const publico = {
    get camera() {
      return { ...estado.camera };
    },
    /** Quanto o último arrasto andou, em pixels. O editor usa para separar clique de arrasto. */
    get arrastouPixels() {
      return moveu;
    },
    get tetoTextura() {
      return tetoTextura;
    },
    get temGyro() {
      return !!estado.gyro;
    },

    // ── superficie usada por vr.js ─────────────────────────────────────────
    // O modulo de VR desenha marcadores no MESMO contexto, com programa proprio.
    // Preferi expor estas quatro coisas a mudar vr.js para dentro daqui: o arquivo
    // ja tem 800 linhas e as duas responsabilidades sao separaveis.
    get gl() {
      return gl;
    },
    /** Vista pretendida da cena corrente — { yaw, pitch }, ou null antes da primeira. */
    get vistaCena() {
      return estado.vistaCena ? { ...estado.vistaCena } : null;
    },
    desenharVista,
    /**
     * Liga ou desliga o modo imersivo. Enquanto ligado, desenhar() se cala e o teto de
     * textura cai — quem comanda o quadro e o laco da sessao XR.
     */
    definirModoXR(ligado) {
      estado.xr = !!ligado;
      // Na pratica esta escalada nunca dispara: telefone nao abre sessao immersive-vr,
      // e a janela do navegador do Quest resolve ~10400 px, o que ja cai no ramo da
      // completa em escolherFonte(). Fica porque a promessa e da regra, nao do
      // acidente. Se um dia disparar, o custo e o pico da troca somar a media
      // (~43 MiB com mipmap) a completa (~171 MiB) — e o numero a vigiar no Quest 2.
      // Dentro do headset a memoria e o limite. Segurar blob de vizinho ao lado de
      // uma textura de 8192 e exatamente a soma que a sessao imersiva nao aguenta.
      if (ligado) {
        cancelarPrefetch();
        blobsProntos.clear();
        talvezEscalar({ forcar: true });
      }
      if (!ligado) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        dimensionar();
        pedirQuadro();
      }
    },

    carregar,
    preCarregar,
    projetar,
    doEcra,
    definirCamera,
    zoom,
    pedirQuadro,
    ligarGyro,
    desligarGyro,
    destruir() {
      estado.destruido = true;
      estado.carregamento?.abort();
      cancelarPrefetch();
      blobsProntos.clear();
      encerrarAnimacao();
      desligarGyro();
      observador.disconnect();
      canvas.removeEventListener('pointerdown', aoDescer);
      canvas.removeEventListener('pointermove', aoMoverPonteiro);
      canvas.removeEventListener('pointerup', aoSubir);
      canvas.removeEventListener('pointercancel', aoSubir);
      canvas.removeEventListener('wheel', aoRolar);
      canvas.removeEventListener('keydown', aoTeclar);
      descartar(estado.texA);
      descartar(estado.texB);
      gl.deleteProgram(programa);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
  return publico;
}
