/**
 * Modo imersivo — WebXR, alvo Meta Quest.
 *
 * Por que este arquivo existe separado: dentro de uma sessao imersiva o DOM da pagina
 * NAO e composto no headset; so a camada WebGL aparece. Os hotspots do tour normal sao
 * <button> de HTML sobre o canvas, e ali eles simplesmente nao existiriam. Aqui eles
 * sao redesenhados em 3D, com raycast de controlador.
 *
 * O panorama continua sendo desenhado por panorama.js, uma vez por olho. Este modulo
 * cuida da sessao, dos marcadores, da mira e do painel de detalhe.
 *
 * Limite herdado da foto: panorama monoscopico esta no infinito, entao translacao da
 * cabeca e ignorada — girar funciona, andar nao muda nada. Os marcadores e o painel,
 * por estarem a alguns metros, tem paralaxe real e sao a unica coisa com profundidade.
 */

import { direcaoDe } from './panorama.js';
import { grausDaSeta } from './comum.js';

/** Distância dos marcadores. Longe o bastante para não cansar a convergência. */
const RAIO_MARCADOR = 6;
const RAIO_PAINEL = 2.4;
/** Tolerância angular da mira, em graus. Generosa: apontar com o braço tem tremor. */
const TOLERANCIA = 4.5;

const VERTEX = `#version 300 es
in vec2 aQuad;
out vec2 vUv;

uniform mat4 uVP;
uniform vec3 uCentro;
uniform vec3 uDireita;
uniform vec3 uCima;
uniform vec2 uTamanho;

void main() {
  // O -y inverte a coordenada vertical de textura.
  //
  // Nao e gosto: o WebGL amostra com v=0 embaixo, e texImage2D preenche v=0 com a
  // PRIMEIRA linha da fonte — que num canvas 2D e a linha de cima. Sem inverter, o topo
  // do quad mostra o rodape do canvas e todo texto sai de cabeca para baixo, so no eixo
  // vertical. Corrigir aqui, e nao com UNPACK_FLIP_Y_WEBGL, porque aquele sinalizador e
  // estado global do contexto e este contexto e compartilhado com panorama.js, que
  // depende de nao ter inversao nenhuma.
  vUv = vec2(aQuad.x, -aQuad.y) * 0.5 + 0.5;
  vec3 p = uCentro + uDireita * (aQuad.x * uTamanho.x) + uCima * (aQuad.y * uTamanho.y);
  gl_Position = uVP * vec4(p, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 corFinal;

uniform sampler2D uTex;
uniform vec4 uTinta;
uniform float uUsarTextura;

void main() {
  vec4 c = uUsarTextura > 0.5 ? texture(uTex, vUv) : vec4(1.0);
  corFinal = c * uTinta;
  if (corFinal.a < 0.01) discard;
}`;

// ── desenho em canvas, para virar textura ───────────────────────────────────

const TINTA = '#1E1E1E';
const PAPEL = '#F5F5F5';
const HAIRLINE = '#BDBDBD';
const FONTE_TITULO = '600 34px "Space Grotesk", system-ui, sans-serif';
const FONTE_CORPO = '400 26px Archivo, system-ui, sans-serif';
const FONTE_ROTULO = '600 30px Archivo, system-ui, sans-serif';

function canvasNovo(l, a) {
  const c = document.createElement('canvas');
  c.width = l;
  c.height = a;
  return { c, ctx: c.getContext('2d') };
}

function retanguloArredondado(ctx, x, y, l, a, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + l, y, x + l, y + a, r);
  ctx.arcTo(x + l, y + a, x, y + a, r);
  ctx.arcTo(x, y + a, x, y, r);
  ctx.arcTo(x, y, x + l, y, r);
  ctx.closePath();
}

/**
 * Marcador de passagem: anel com seta e o nome do destino embaixo.
 * O rótulo é o que diferencia "uma porta" de "a varanda social" — sem ele o visitante
 * aponta às cegas.
 */
function texturaPassagem(rotulo, giro = 0) {
  const { c, ctx } = canvasNovo(512, 512);
  const cx = 256;
  const cy = 200;

  ctx.fillStyle = 'rgba(30,30,30,0.30)';
  ctx.beginPath();
  ctx.arc(cx, cy, 96, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, 92, 0, Math.PI * 2);
  ctx.stroke();

  // seta para a frente, não um X: o gesto é atravessar. Gira junto com a do tour
  // normal, senao o mesmo ponto apontaria para lados diferentes no headset e na tela.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((giro * Math.PI) / 180);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-26, -26);
  ctx.lineTo(22, 0);
  ctx.lineTo(-26, 26);
  ctx.stroke();
  ctx.restore();

  if (rotulo) {
    ctx.font = FONTE_ROTULO;
    ctx.textAlign = 'center';
    const largura = Math.min(470, ctx.measureText(rotulo).width + 44);
    ctx.fillStyle = 'rgba(30,30,30,0.72)';
    retanguloArredondado(ctx, cx - largura / 2, cy + 118, largura, 56, 8);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'middle';
    ctx.fillText(rotulo, cx, cy + 147, largura - 32);
  }
  return c;
}

/** Marcador de informação: disco claro com um "i", vocabulário oposto ao da passagem. */
function texturaInfo() {
  const { c, ctx } = canvasNovo(256, 256);
  ctx.fillStyle = 'rgba(245,245,245,0.92)';
  ctx.beginPath();
  ctx.arc(128, 128, 84, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = TINTA;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(128, 128, 84, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = TINTA;
  ctx.beginPath();
  ctx.arc(128, 82, 11, 0, Math.PI * 2);
  ctx.fill();
  retanguloArredondado(ctx, 118, 106, 20, 74, 6);
  ctx.fill();
  return c;
}

function quebrar(ctx, texto, largura) {
  const linhas = [];
  for (const paragrafo of String(texto).split(/\n+/)) {
    let linha = '';
    for (const palavra of paragrafo.split(/\s+/)) {
      const tentativa = linha ? `${linha} ${palavra}` : palavra;
      if (ctx.measureText(tentativa).width > largura && linha) {
        linhas.push(linha);
        linha = palavra;
      } else {
        linha = tentativa;
      }
    }
    linhas.push(linha);
    linhas.push('');
  }
  while (linhas.at(-1) === '') linhas.pop();
  return linhas;
}

/** Painel de detalhe. Altura cresce com o texto; devolve também a proporção. */
function texturaPainel(titulo, texto) {
  const L = 1024;
  const margem = 64;
  const medida = canvasNovo(8, 8).ctx;
  medida.font = FONTE_CORPO;
  const linhas = quebrar(medida, texto || '', L - margem * 2);
  const alturaTexto = linhas.length * 40;
  const A = Math.min(1024, Math.max(320, 200 + alturaTexto + margem));

  const { c, ctx } = canvasNovo(L, A);
  ctx.fillStyle = PAPEL;
  retanguloArredondado(ctx, 0, 0, L, A, 16);
  ctx.fill();
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 2;
  retanguloArredondado(ctx, 1, 1, L - 2, A - 2, 16);
  ctx.stroke();

  // régua do degradê da marca, o mesmo detalhe do painel na versão de tela
  const g = ctx.createLinearGradient(margem, 0, L - margem, 0);
  g.addColorStop(0, '#EFDCC5');
  g.addColorStop(0.34, '#EFBEAA');
  g.addColorStop(0.68, '#D8E2D7');
  g.addColorStop(1, '#C0D3DF');
  ctx.fillStyle = g;
  ctx.fillRect(margem, margem, L - margem * 2, 5);

  ctx.fillStyle = '#808080';
  ctx.font = '600 20px "Space Grotesk", system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('DETALHE', margem, margem + 44);

  ctx.fillStyle = '#1E1E1E';
  ctx.font = FONTE_TITULO;
  ctx.fillText(titulo || 'Informação', margem, margem + 96, L - margem * 2);

  ctx.fillStyle = '#353535';
  ctx.font = FONTE_CORPO;
  let y = margem + 156;
  for (const linha of linhas) {
    ctx.fillText(linha, margem, y);
    y += 40;
  }

  // fechar: aponte para fora e aperte
  ctx.fillStyle = '#7F7F7F';
  ctx.font = '400 20px Archivo, system-ui, sans-serif';
  ctx.fillText('Aponte para fora e aperte o gatilho para fechar', margem, A - 34);

  return { canvas: c, proporcao: A / L };
}

// ── vetores ─────────────────────────────────────────────────────────────────

const girarY = (v, a) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: c * v.x + s * v.z, y: v.y, z: -s * v.x + c * v.z };
};
const norma = (v) => Math.hypot(v.x, v.y, v.z);
const normalizar = (v) => {
  const n = norma(v) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};
const cruz = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const ponto = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Multiplica 4x4 column-major. */
function mult4(a, b, out) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/**
 * Base de um quad que encara a origem, que é onde a cabeça está sempre — panorama no
 * infinito significa translação ignorada, então um marcador virado para o centro está
 * virado para quem olha, e a base pode ser calculada uma vez só.
 */
function baseEncarando(centro) {
  const frente = normalizar({ x: -centro.x, y: -centro.y, z: -centro.z });
  const cimaMundo = Math.abs(frente.y) > 0.99 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const direita = normalizar(cruz(cimaMundo, frente));
  const cima = cruz(frente, direita);
  return { direita, cima };
}

// ── módulo ──────────────────────────────────────────────────────────────────

export async function suportaVR() {
  try {
    return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr')));
  } catch {
    return false;
  }
}

/**
 * @param {object} pano  instância de criarPanorama
 * @param {{ hotspots: () => object[], nomeCena: (id) => string,
 *           aoNavegar: (id) => Promise<void>, aoSair?: () => void }} liga
 */
export function criarVR(pano, liga) {
  const gl = pano.gl;

  const programa = gl.createProgram();
  for (const [tipo, fonte] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
    const s = gl.createShader(tipo);
    gl.shaderSource(s, fonte);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`shader VR: ${gl.getShaderInfoLog(s)}`);
    }
    gl.attachShader(programa, s);
  }
  gl.linkProgram(programa);
  if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) {
    throw new Error(`programa VR: ${gl.getProgramInfoLog(programa)}`);
  }

  const u = {
    vp: gl.getUniformLocation(programa, 'uVP'),
    centro: gl.getUniformLocation(programa, 'uCentro'),
    direita: gl.getUniformLocation(programa, 'uDireita'),
    cima: gl.getUniformLocation(programa, 'uCima'),
    tamanho: gl.getUniformLocation(programa, 'uTamanho'),
    tex: gl.getUniformLocation(programa, 'uTex'),
    tinta: gl.getUniformLocation(programa, 'uTinta'),
    usarTextura: gl.getUniformLocation(programa, 'uUsarTextura'),
  };

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const aQuad = gl.getAttribLocation(programa, 'aQuad');
  gl.enableVertexAttribArray(aQuad);
  gl.vertexAttribPointer(aQuad, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const cacheTex = new Map();
  function textura(chave, fazerCanvas) {
    if (cacheTex.has(chave)) return cacheTex.get(chave);
    const canvas = fazerCanvas();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    cacheTex.set(chave, tex);
    return tex;
  }

  const est = {
    sessao: null,
    refSpace: null,
    camada: null,
    giroMundo: 0,
    alvos: [],
    apontado: null,
    painel: null,
    vp: new Float32Array(16),
    inv: new Float32Array(16),
    navegando: false,
  };

  /**
   * Remonta os alvos a partir dos hotspots da cena.
   *
   * A posição em mundo leva Ry(-giroMundo) porque giroMundo gira a AMOSTRAGEM do
   * panorama: uma direção de imagem aparece no mundo girada ao contrário. Sem isso os
   * marcadores descolariam da parede assim que a cena fosse realinhada.
   */
  function remontarAlvos() {
    est.alvos = (liga.hotspots() || []).map((h) => {
      const dirImagem = direcaoDe(h.yaw, h.pitch);
      const d = girarY(dirImagem, -est.giroMundo);
      const centro = { x: d.x * RAIO_MARCADOR, y: d.y * RAIO_MARCADOR, z: d.z * RAIO_MARCADOR };
      const passagem = h.tipo === 'navegacao';
      return {
        h,
        centro,
        dir: d,
        ...baseEncarando(centro),
        tamanho: passagem ? 0.62 : 0.34,
        tex: passagem
          ? textura(`p:${h.destinoId}:${h.direcao || ''}:${liga.nomeCena(h.destinoId)}`, () =>
            texturaPassagem(liga.nomeCena(h.destinoId), grausDaSeta(h.direcao)))
          : textura('i', texturaInfo),
      };
    });
    est.apontado = null;
  }

  /** Alinha a cena com onde a cabeça já está, para a travessia não desorientar. */
  function realinhar(yawCabeca) {
    const alvo = pano.vistaCena?.yaw ?? 0;
    est.giroMundo = alvo - yawCabeca;
  }

  function yawDe(orientacao) {
    // direção -Z girada pelo quaternion, reduzida ao plano
    const { x, y, z, w } = orientacao;
    const dx = -2 * (x * z + w * y);
    const dz = -(1 - 2 * (x * x + y * y));
    return Math.atan2(-dx, -dz);
  }

  function desenharQuad(centro, direita, cima, tamanho, tex, tinta) {
    gl.uniform3f(u.centro, centro.x, centro.y, centro.z);
    gl.uniform3f(u.direita, direita.x, direita.y, direita.z);
    gl.uniform3f(u.cima, cima.x, cima.y, cima.z);
    gl.uniform2f(u.tamanho, tamanho.x, tamanho.y);
    gl.uniform4f(u.tinta, tinta[0], tinta[1], tinta[2], tinta[3]);
    gl.uniform1f(u.usarTextura, tex ? 1 : 0);
    if (tex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u.tex, 0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function desenharCamada(vista) {
    mult4(vista.projectionMatrix, vista.transform.inverse.matrix, est.vp);

    gl.useProgram(programa);
    gl.bindVertexArray(vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(u.vp, false, est.vp);

    if (est.painel) {
      const p = est.painel;
      desenharQuad(p.centro, p.direita, p.cima, p.tamanho, p.tex, [1, 1, 1, 1]);
    } else {
      for (const a of est.alvos) {
        const mirado = a === est.apontado;
        const escala = mirado ? 1.22 : 1;
        desenharQuad(
          a.centro,
          a.direita,
          a.cima,
          { x: a.tamanho * escala, y: a.tamanho * escala },
          a.tex,
          mirado ? [1, 1, 1, 1] : [1, 1, 1, 0.82],
        );
      }
    }

    // mira: um ponto no fim do raio, para saber para onde se está apontando
    if (est.mira) {
      const c = est.mira;
      desenharQuad(c.centro, c.direita, c.cima, { x: 0.035, y: 0.035 }, null, [1, 1, 1, 0.9]);
    }

    gl.disable(gl.BLEND);
  }

  /** Melhor alvo para um raio, por menor ângulo — tolerante ao tremor do braço. */
  function mirar(origem, direcao) {
    let melhor = null;
    let menor = TOLERANCIA * (Math.PI / 180);
    for (const a of est.alvos) {
      const v = normalizar({
        x: a.centro.x - origem.x,
        y: a.centro.y - origem.y,
        z: a.centro.z - origem.z,
      });
      const ang = Math.acos(Math.min(1, Math.max(-1, ponto(v, direcao))));
      if (ang < menor) {
        menor = ang;
        melhor = a;
      }
    }
    return melhor;
  }

  function raioDeEntrada(quadro) {
    for (const fonte of est.sessao.inputSources) {
      if (!fonte.targetRaySpace) continue;
      const pose = quadro.getPose(fonte.targetRaySpace, est.refSpace);
      if (!pose) continue;
      const m = pose.transform.matrix;
      return {
        origem: { x: m[12], y: m[13], z: m[14] },
        direcao: normalizar({ x: -m[8], y: -m[9], z: -m[10] }),
      };
    }
    return null;
  }

  function abrirPainel(h) {
    const { canvas, proporcao } = texturaPainel(h.titulo, h.texto);
    const chave = `d:${h.id}:${h.titulo}:${(h.texto || '').length}`;
    const tex = textura(chave, () => canvas);
    const d = girarY(direcaoDe(h.yaw, h.pitch), -est.giroMundo);
    // um pouco acima da linha do horizonte do marcador, para não cobrir o próprio ponto
    const centro = { x: d.x * RAIO_PAINEL, y: d.y * RAIO_PAINEL + 0.15, z: d.z * RAIO_PAINEL };
    const largura = 0.78;
    est.painel = {
      centro,
      ...baseEncarando(centro),
      tamanho: { x: largura, y: largura * proporcao },
      tex,
    };
  }

  async function acionar() {
    if (est.painel) {
      est.painel = null;
      return;
    }
    const a = est.apontado;
    if (!a) return;

    if (a.h.tipo === 'navegacao') {
      if (est.navegando) return;
      est.navegando = true;
      try {
        await liga.aoNavegar(a.h.destinoId);
      } finally {
        est.navegando = false;
      }
      return;
    }
    abrirPainel(a.h);
  }

  function quadroXR(_agora, quadro) {
    if (!est.sessao) return;
    est.sessao.requestAnimationFrame(quadroXR);

    const pose = quadro.getViewerPose(est.refSpace);
    if (!pose) return;

    const camada = est.sessao.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, camada.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // mira e alvo se resolvem uma vez por quadro, não uma vez por olho
    const raio = raioDeEntrada(quadro);
    const cabeca = pose.transform;
    // Guardado porque cenaTrocada() vem de fora do quadro e precisa deste valor para
    // realinhar a cena com a direção em que a cabeça já está.
    est.yawCabeca = yawDe(cabeca.orientation);
    const usado = raio || {
      origem: { x: cabeca.position.x, y: cabeca.position.y, z: cabeca.position.z },
      direcao: normalizar({
        x: -cabeca.matrix[8],
        y: -cabeca.matrix[9],
        z: -cabeca.matrix[10],
      }),
    };
    est.apontado = est.painel ? null : mirar(usado.origem, usado.direcao);
    const pontaX = usado.origem.x + usado.direcao.x * RAIO_MARCADOR;
    const pontaY = usado.origem.y + usado.direcao.y * RAIO_MARCADOR;
    const pontaZ = usado.origem.z + usado.direcao.z * RAIO_MARCADOR;
    const ponta = { x: pontaX, y: pontaY, z: pontaZ };
    est.mira = { centro: ponta, ...baseEncarando(ponta) };

    /**
     * O scissor não é zelo: é necessário.
     *
     * gl.viewport NÃO recorta, só transforma coordenadas. O panorama é um triângulo de
     * tela cheia que vai de NDC -1 a 3, e depois da transformação de viewport ele cobre
     * bem mais que a metade do olho corrente — invade a região do outro olho. Sem
     * recorte, o que sobra na tela depende da ordem em que os olhos são desenhados e de
     * como o runtime arruma os dois no framebuffer, e a imagem sai duplicada ou com o
     * olho errado. O scissor é o único estágio que descarta fragmento fora do retângulo.
     */
    gl.enable(gl.SCISSOR_TEST);
    for (const vista of pose.views) {
      const vp = camada.getViewport(vista);
      gl.scissor(vp.x, vp.y, vp.width, vp.height);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      pano.desenharVista(vista, vp, est.giroMundo);
      desenharCamada(vista);
    }
    gl.disable(gl.SCISSOR_TEST);
  }

  async function entrar() {
    if (est.sessao) return est.sessao;

    const sessao = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'hand-tracking'],
    });
    est.sessao = sessao;
    pano.definirModoXR(true);

    await gl.makeXRCompatible();
    est.camada = new XRWebGLLayer(sessao, gl, { antialias: false });
    sessao.updateRenderState({ baseLayer: est.camada });

    est.refSpace = await sessao
      .requestReferenceSpace('local')
      .catch(() => sessao.requestReferenceSpace('viewer'));

    // Em espaço 'local' a origem é fixada na criação da sessão, então a cabeça começa
    // em yaw ~0 e realinhar(0) põe a vista de entrada da cena à frente de quem entrou.
    realinhar(0);
    remontarAlvos();

    sessao.addEventListener('select', () => { acionar(); });
    sessao.addEventListener('inputsourceschange', () => {});
    sessao.addEventListener('end', () => {
      est.sessao = null;
      est.painel = null;
      est.mira = null;
      pano.definirModoXR(false);
      liga.aoSair?.();
    });

    sessao.requestAnimationFrame(quadroXR);
    return sessao;
  }

  return {
    entrar,
    get ativo() {
      return !!est.sessao;
    },
    /** O tour chama depois de trocar de cena: realinha o mundo e remonta os alvos. */
    cenaTrocada() {
      realinhar(est.yawCabeca || 0);
      est.painel = null;
      remontarAlvos();
    },
    sair() {
      est.sessao?.end();
    },
    destruir() {
      est.sessao?.end();
      for (const t of cacheTex.values()) gl.deleteTexture(t);
      cacheTex.clear();
      gl.deleteProgram(programa);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
    },
  };
}
