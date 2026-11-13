/**
 * Parametros de publicacao.
 *
 * Unico lugar do projeto que precisa saber o endereco publico. As meta tags de
 * compartilhamento exigem URL absoluta: quem le og:image e o robo do WhatsApp, de
 * outro servidor, e caminho relativo nao resolve para ele.
 *
 * Enquanto URL_BASE estiver em branco o export avisa em voz alta e gera as tags sem
 * og:image. O link continua circulando e o tour continua funcionando — so nao ganha
 * miniatura. Preencher aqui e regerar o pacote resolve, sem tocar em mais nada.
 *
 * Sem barra no fim: "https://tours.lesco.com.br".
 */
export const URL_BASE = '';

/** Assinatura institucional, usada na capa do acervo e como reserva na descricao. */
export const MARCA = 'Revestimentos Lesco';
