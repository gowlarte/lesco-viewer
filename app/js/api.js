/**
 * Cliente da API do editor. Só existe do lado da gestão — o tour exportado lê
 * arquivos JSON estáticos e nunca chama nada disto.
 */

async function pedir(url, opcoes = {}) {
  const resposta = await fetch(url, opcoes);
  const tipo = resposta.headers.get('content-type') || '';
  const corpo = tipo.includes('json') ? await resposta.json().catch(() => null) : null;
  if (!resposta.ok) {
    throw new Error(corpo?.erro || `Falha na requisição (${resposta.status}).`);
  }
  return corpo;
}

const json = (corpo) => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
});

export const api = {
  listarTours: () => pedir('/api/tours'),

  criarTour: (dados) => pedir('/api/tours', { method: 'POST', ...json(dados) }),

  lerTour: (slug) => pedir(`/api/tours/${slug}`),

  salvarTour: (slug, tour) => pedir(`/api/tours/${slug}`, { method: 'PUT', ...json(tour) }),

  removerTour: (slug) => pedir(`/api/tours/${slug}`, { method: 'DELETE' }),

  /** Envia um derivado de uma cena. `arquivo` é "c3.jpg", "c3.media.jpg", "c3.preview.jpg"... */
  enviarMidia: (slug, arquivo, blob) =>
    pedir(`/api/media/${slug}/${arquivo}`, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: blob,
    }),

  removerMidia: (slug, cenaId) => pedir(`/api/media/${slug}/${cenaId}.jpg`, { method: 'DELETE' }),

  removerCompartilhar: (slug) =>
    pedir(`/api/media/${slug}/${ARQUIVO_COMPARTILHAR}`, { method: 'DELETE' }),

  exportar: () => pedir('/api/export', { method: 'POST' }),

  /** Como este servidor esta alcancavel de fora da maquina. Alimenta o QR do editor. */
  rede: () => pedir('/api/rede'),
};

/**
 * Caminhos das derivadas de uma cena. Uma única fonte de verdade.
 *
 * `media` sai daqui sempre; quem decide se existe em disco é o campo `temMedia` da
 * cena, e quem decide se vale usá-la é panorama.js. Devolver o caminho de um arquivo
 * que pode não existir é de propósito: a alternativa seria esta função precisar da
 * cena inteira, e não só do id.
 */
export function caminhosDaCena(slug, cenaId) {
  return {
    completa: `/media/${slug}/${cenaId}.jpg`,
    media: `/media/${slug}/${cenaId}.media.jpg`,
    previa: `/media/${slug}/${cenaId}.preview.jpg`,
    miniatura: `/media/${slug}/${cenaId}.thumb.jpg`,
  };
}

export const nomesDeArquivo = (cenaId) => ({
  completa: `${cenaId}.jpg`,
  media: `${cenaId}.media.jpg`,
  previa: `${cenaId}.preview.jpg`,
  miniatura: `${cenaId}.thumb.jpg`,
});

/** A foto de compartilhamento é da obra, não de uma cena — daí o nome fixo. */
export const ARQUIVO_COMPARTILHAR = 'compartilhar.jpg';
export const caminhoCompartilhar = (slug) => `/media/${slug}/${ARQUIVO_COMPARTILHAR}`;
