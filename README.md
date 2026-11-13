# Lesco Viewer — tours 360

Ferramenta de tours virtuais das obras entregues. Dois lados:

| | |
| --- | --- |
| **Gestão** (`/gestao`) | Interno. Sobe os panoramas, liga os ambientes por pontos de passagem, anota detalhes e publica. Roda só na sua máquina. |
| **Acervo** (`/`) e **tour** | Público. É o que vai para a internet, como pasta estática. |

Interface construída sobre o design system do **Lesco Vault** — mesmos tokens, mesmos
componentes (`.btn`, `.pill`, `.field`, `.card`, `.painel`), mesma tipografia. Quem já
usa o Vault não reaprende nada.

**Sem build e sem dependência.** Nenhum `npm install`. O servidor usa só módulos nativos
do Node; o redimensionamento das fotos acontece no canvas do navegador; o panorama é
renderizado em WebGL2 escrito à mão.

---

## Rodar

```bash
npm run dev
```

- Gestão: <http://127.0.0.1:4360/gestao>
- Acervo: <http://127.0.0.1:4360/>

Escuta apenas em `127.0.0.1`.

---

## Abrir de outro aparelho da rede

Para ver o tour no celular ou no tablet:

```bash
npm run dev:rede
```

Escuta em `0.0.0.0` e imprime os endereços prontos para digitar. Na primeira vez o
Windows Firewall bloqueia a porta; libere uma vez, num PowerShell **como administrador**:

```bash
powershell -ExecutionPolicy Bypass -File ferramentas/abrir-porta-firewall.ps1
```

A regra fica restrita ao perfil Private e à LocalSubnet — não abre nada em rede pública
nem fora da sua faixa de IP. Para fechar depois:

```bash
powershell -ExecutionPolicy Bypass -File ferramentas/abrir-porta-firewall.ps1 -Remover
```

Com `--rede` ligado, o editor de cada obra ganha um botão **QR** ao lado de "Ver". Ele
mostra o endereço da LAN como código de barras — é o caminho para abrir o tour no Quest
sem digitar `172.16.x.x:4360` no teclado virtual.

Só um servidor por vez: subir um segundo é recusado com aviso, em vez de aceito. No
Windows, escutar em `0.0.0.0` não colide com um bind anterior em `127.0.0.1` — o sistema
aceita os dois e passa a entregar requisição de localhost a um processo e requisição da
rede a outro, dois servidores no mesmo `data/` sem nenhum erro na tela. Para rodar duas
instâncias de propósito, mude a porta: `PORT=4361 npm run dev`.

### Duas coisas a saber

**Não há autenticação.** Gravar tour, apagar tour e apagar as fotos de uma obra são
requisições sem credencial. Com `--rede`, qualquer aparelho que alcance a porta pode
fazer isso. É por isso que a exposição mora numa flag e não no `npm run dev`: use em
rede que você controla e derrube o servidor quando terminar.

**O giroscópio não funciona por HTTP.** `DeviceOrientationEvent` exige contexto seguro,
e só `localhost` é isento — `http://172.16.x.x` não é. O botão de giro diz isso quando
tocado. Todo o resto do tour funciona: arrasto, pinça, tira de ambientes, folha de
detalhe, tela cheia.

---

## Montar um tour

1. **Novo tour** — nome da obra, cidade, tipo, ano, escritório. O nome define o endereço
   público (`Resort Jurerê` → `/resort-jurere`) e ele não muda depois, mesmo que o nome mude.
2. **Subir os panoramas** — arraste os JPG equirretangulares na coluna da esquerda, um
   arquivo por ambiente. Cada foto vira quatro arquivos, e o principal deles não é tocado:

   | | largura | peso | para quê |
   | --- | --- | --- | --- |
   | completa | original | 10–25 MB | **sem recompressão**; é o que o cliente vê no VR |
   | de tela | 4096px | ~1 MB | o que o celular baixa; medido em 23× menos que a completa |
   | prévia | 1536px | ~150 KB | entra primeiro, para o ambiente aparecer na hora |
   | miniatura | 480px | ~35 KB | tira de ambientes e capa do acervo |

   A completa é o arquivo que saiu da câmera, byte a byte. JPEG de câmera 360 já vem
   comprimido; reencodar em cima disso é perda geracional que não volta. Só há duas
   exceções, e o editor avisa quando cai numa delas: PNG e arquivo acima de 120 MB são
   reencodados em qualidade 0.98, ainda sem reduzir a largura.

   Obra subida antes da derivada de tela aparece na coluna dos ambientes com o aviso e o
   botão **Gerar imagens de tela**, que produz só o que falta, sem tocar nos originais.

   Se a proporção não for 2:1, o editor aceita mas avisa — a projeção pode distorcer.

3. **Nomear os ambientes** — o nome é o rótulo que o visitante lê no ponto de passagem.
   "Deck da piscina" funciona; "IMG_0234" não.
4. **Ligar os ambientes** — **Ponto de passagem**, depois clique na porta, no vão, no
   início do corredor. Escolha para onde leva. Faça o caminho de volta também: passagem
   só vale num sentido.
5. **Anotar detalhes** — **Informação**, clique no detalhe, escreva título e texto.
   É onde entra a especificação: linha, acabamento, medida, fixação.
6. **Fixar a vista de entrada** — enquadre o ambiente e use **Fixar vista de entrada**.
   Sem isso o visitante entra em 0° e pode cair olhando para uma parede.
7. **Publicar** — ligue a chave no topo. Ela grava **e regera o pacote** na mesma ação, então
   a obra entra no acervo na hora. Rascunho não sai no pacote. A chave fica desligada
   enquanto o tour não tiver nenhum ambiente, com o motivo escrito ao lado.

**Excluir uma obra** é na listagem, no ícone de lixeira do cartão. Apaga a ficha e os
panoramas processados, e não há como desfazer — não existe lixeira aqui, e os originais
moram fora do projeto. Se a obra estava publicada, o pacote é regerado para ela sair do
acervo imediatamente. Para apagar só um ambiente, use o editor.

Arraste um ponto sobre o panorama para reposicionar. `Ctrl+S` salva. `Esc` cancela a
colocação de um ponto.

---

## Ver no headset (Meta Quest)

WebXR só opera em contexto seguro, e o headset é outro aparelho — em `http://IP` o
`navigator.xr` nem existe. Então o modo VR exige https. Uma vez, para gerar o certificado:

```bash
npm run cert
```

Depois, sempre que quiser usar o headset:

```bash
npm run dev:vr
```

No navegador do Quest, abra o endereço `https://` que o servidor imprimiu. Ele vai
**acusar certificado não confiável** — é esperado, o certificado é seu e não vem de uma
autoridade. Aceite o aviso e siga. Aí toque em **VR** na barra do tour.

Dentro do headset: aponte o controlador e aperte o gatilho. Anel com seta atravessa para
outro ambiente; disco claro com "i" abre o detalhe. Para fechar o detalhe, aponte para
fora dele e aperte. Pinça de mão funciona igual ao gatilho, se você usa hand tracking.

Regere o certificado se o IP da máquina mudar — ele é emitido para o endereço atual.

### O que o VR entrega e o que não entrega

Suas fotos são **monoscópicas**: uma esfera só. Em VR isso dá presença e escala reais,
mas **não dá profundidade estereoscópica** — é como estar dentro de uma esfera pintada.
Girar a cabeça funciona; andar não muda nada, porque a foto está no infinito. Os
marcadores e o painel de detalhe, por estarem a poucos metros, são as únicas coisas com
paralaxe de verdade. Profundidade real exigiria câmera 360 estéreo, e daria para
acrescentar depois sem refazer o que existe.

Dentro do headset o panorama carrega a **8192px**, seja qual for o tamanho do arquivo em
disco. O teto existe porque em VR o limite é a memória, não o driver: 8192×4096 RGBA ocupa
128 MiB, ~171 MiB com mipmap.

Esse número foi 6144 enquanto o panorama guardado era um JPEG reduzido a 8192px, e a conta
que o justificava estava errada — 6144 rende 1536 px por 90° de campo, enquanto o Quest 2
desenha 1832 px por olho em ~89° e o Quest 3 desenha 2064 em ~110°. O painel resolvia mais
que a textura, e era daí que vinha boa parte da maciez da foto no headset.

O pico da travessia soma ao panorama a **prévia**, não um segundo panorama completo: é a
prévia de 1536px que ocupa a outra ponta do fade, ~6 MiB. Por isso ela não é opcional
aqui — sem prévia o fade cruza dois panoramas inteiros e o pico dobra. Se um Quest 2 morrer
numa cena, o número a baixar é o `8192` em `tetoAtual()`, em `app/js/panorama.js`.

---

## Publicar

Antes de publicar pela primeira vez, preencha `URL_BASE` em **`config.js`** com o endereço
de produção — sem barra no fim. É o único parâmetro de configuração do projeto, e existe
porque as meta tags de compartilhamento exigem URL absoluta: quem lê `og:image` é o robô do
WhatsApp, de outro servidor, e caminho relativo não resolve para ele. Enquanto estiver em
branco o export avisa e o link circula sem miniatura — nada quebra, só não é clicado.

Publicar uma obra já regera o pacote sozinho. O botão **Gerar pacote público** na listagem
serve para reconstruir tudo sem mexer em publicação — depois de editar hotspots, trocar uma
foto ou ajustar a ficha de uma obra que já estava publicada. Salvar uma obra publicada
avisa na hora que o pacote ficou para trás, e a listagem marca **pacote desatualizado** na
obra até o pacote ser regerado. Regerar continua sendo ação explícita: reconstruir 700 MB a
cada `Ctrl+S` não se sustenta. Ou:

```bash
npm run export
```

Monta `dist/`:

```
dist/
  index.html                  capa do acervo
  resort-jurere/index.html    uma pasta por obra publicada
  data/  media/  app/
```

O pacote leva **só** o código do lado público — o editor, o cliente da API e o pipeline
de imagem ficam fora. A lista está em `ARQUIVOS_PUBLICOS`, no `server.js`: arquivo novo
do lado público precisa ser declarado lá, senão não vai.

### Vercel

Site estático, sem build. Ao importar:

- **Framework Preset:** Other
- **Build / Install Command:** vazio
- **Output Directory:** `dist`

Os tours ficam **abertos a quem tiver o link** e são indexáveis. Se alguma obra não puder
ser pública, não publique aquele tour — ou ligue **Deployment Protection** no projeto da
Vercel, que fecha o deploy inteiro.

O `dist/vercel.json` gerado marca `/media/` como imutável por um ano: panorama publicado
não muda, e é onde está o peso. A exceção é `compartilhar.jpg`, a foto de compartilhamento
da obra — é a única mídia de nome fixo, então pode ser trocada, e servir a antiga por um
ano seria irreversível na prática.

### O link que circula

Cada obra sai com as meta tags assadas no HTML — título, descrição e miniatura — para o
link render thumbnail no WhatsApp e no e-mail. A miniatura é a **foto de compartilhamento**
que você sobe na ficha da obra: foto do empreendimento, não panorama, recortada em
1200×630. Sem ela o export usa a prévia da cena de capa, que é equirretangular e sai com o
teto e o piso esticados — e avisa, por obra, quais estão nessa situação.

Dentro do tour, o endereço acompanha o ambiente e o enquadramento:

```
/biotique                        a obra, pela capa
/biotique#c5                     direto no ambiente, na vista de entrada dele
/biotique#c5@-2.995,-0.185,54.0  no ambiente e no enquadramento exato
```

O botão de elo no topo do tour copia o endereço da vista corrente. Hash inválido, ambiente
que não existe mais ou número fora de faixa abrem a capa da obra em silêncio — nunca um
erro na tela de quem recebeu o link.

---

## Onde ficam as coisas

```
server.js                 servidor do editor e gerador do pacote (só nativos do Node)
index.html  tour.html     páginas do lado público
gestao/                   páginas do lado interno
app/css/tokens.css        tokens do Lesco Vault + a extensão --foto-* deste produto
app/css/base.css          primitivas: .btn .pill .field .card .painel .toast
app/js/panorama.js        renderizador equirretangular em WebGL2
app/js/vr.js              modo imersivo WebXR: sessão, marcadores 3D, mira, painel
app/js/hotspots.js        camada de pontos, como <button> sobre o canvas
app/js/imagem.js          as quatro derivadas, geradas no navegador
app/js/qr.js              codificador de QR próprio — o botão QR do editor em --rede
config.js                 URL_BASE de produção, para as meta tags de compartilhamento
data/tours/<slug>/        tour.json — a fonte de verdade de cada obra
media/<slug>/             panoramas processados
ferramentas/              gerador de panorama sintético, para testar o renderer
```

`data/` e `media/` são conteúdo, não código. `media/` e `dist/` estão no `.gitignore`:
panorama pesa e `dist/` é sempre reconstruível.

---

## Decisões que não são óbvias

**Renderer próprio em vez de biblioteca.** O panorama não é uma esfera texturizada: é um
quad de tela cheia com um fragment shader que calcula a direção do raio por pixel. Isso
dá duas coisas que importam para a Lesco — nenhum artefato de tesselação nas ripas do
brise, e a travessia entre ambientes vira um mix de duas texturas no mesmo passe. E os
hotspots ficam sendo `<button>` de HTML sobre o canvas, então herdam o design system
inteiro e continuam navegáveis por teclado e leitor de tela, o que marcador de biblioteca
desenhado dentro da textura não seria.

**O frustum assimétrico tem uma armadilha de sinal.** Em `raioDeVista`, o deslocamento do
centro óptico entra **somando**: de `clip.x = P00·vx + P02·vz` com `vz = -1` sai
`vx = (ndc.x + P02) / P00`. Com o sinal trocado nada acontece em tela plana, porque ali o
frustum é simétrico e `P02 = 0` — e é exatamente por isso que todo teste de tela passa e o
erro só nasce dentro do headset, onde cada olho tem `P02` de sinal oposto e as duas imagens
se afastam com o dobro do deslocamento. Se um dia a imagem parar de fundir em VR, olhe este
sinal antes de qualquer outra coisa. Há um teste de verdade conhecida em
`ferramentas/frustum-verifica.js`.

**Uma matriz de raio, não um par ângulo-mais-rotação.** O shader recebe `uRaio`, que leva
NDC direto para direção em mundo. A formulação anterior separava meia-abertura e rotação,
o que assume frustum **simétrico** — e cada olho de headset tem frustum assimétrico, com
o centro óptico deslocado para fora. Naquela forma a imagem entortaria nas bordas dentro
do VR. A matriz única cobre os dois casos e é algebricamente idêntica à antiga no caminho
de tela plana.

**Os hotspots existem duas vezes.** Na tela são `<button>` de HTML sobre o canvas, para
herdarem o design system e funcionarem com teclado e leitor de tela. Dentro de uma sessão
imersiva o DOM não é composto no headset, só a camada WebGL — então lá eles são
redesenhados como quads texturizados, com o visual pintado num canvas 2D. Duas
implementações do mesmo conceito, porque os meios não têm nada em comum.

**Amostragem com `textureGrad` e derivada corrigida na costura.** Sem a correção, a faixa
vertical onde a coordenada horizontal salta de 1 para 0 escolhe o mip mais grosso e
aparece como uma listra borrada no meio da parede. Filtragem anisotrópica também está
ligada: ripa de brise em ângulo raso é o pior caso possível para filtragem isotrópica.

**Redimensionamento no navegador.** Evita biblioteca nativa de imagem no servidor, que
é a única coisa que exigiria `npm install` neste projeto. Vale para a prévia e a
miniatura; a completa não é redimensionada nem recomprimida.

**Decode já no tamanho do teto.** O renderer lê largura e altura do cabeçalho do JPEG
antes de decodificar, e pede o decode direto no tamanho da textura. Virou obrigatório
quando a completa passou a ser a original: decodificar inteiro para reduzir depois faria
um bitmap de 11968×5984, 286 MB de RGBA vivos de uma vez. No desktop passa; num Quest 2
é onde a aba morre, sem mensagem nenhuma.

**Teto de textura do aparelho.** iPhone costuma aceitar 4096px e o panorama pode ter 11000.
O renderer reduz antes de subir para a GPU; sem isso a textura é recusada e a cena fica
preta no celular.

**Vista de entrada é explícita.** Poderia ser gravada sozinha no enquadramento em que a
cena foi salva, mas aí olhar para trás para posicionar um hotspot mudaria por onde o
visitante entra, sem ninguém pedir. Só muda quando se clica no botão.

**O editor não tem versão de celular.** Três colunas simultâneas — ambientes, panorama,
inspetor — não cabem numa faixa estreita. Abaixo de 1080px ele diz isso, em vez de
entregar uma versão mutilada em que se perde um hotspot sem perceber.
