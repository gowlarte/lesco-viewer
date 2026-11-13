# Lesco Viewer — dossiê técnico para elaboração de PRD

> **Como usar este documento.** Ele descreve por inteiro um produto que já existe e está
> em produção. Serve de base para redigir um PRD de **novas** funcionalidades. Antes de
> propor qualquer coisa, leia a seção **3. Restrições de arquitetura** — ela lista
> decisões travadas e escopo que já foi explicitamente recusado. Proposta que viole essas
> restrições não serve, por melhor que seja em abstrato.
>
> Levantado em 02/09/2026 a partir do código e dos dados reais do projeto.

---

## 1. O que é o produto

Ferramenta de **tours virtuais 360°** das obras entregues pela Lesco — empresa de
revestimentos arquitetônicos (brise, painel, Green Brise). A obra é fotografada em
panorama equirretangular, ambiente por ambiente, e o visitante percorre o espaço vendo o
revestimento aplicado no vão que ele resolve, na luz que ele filtra, na escala em que foi
especificado.

São dois lados, no mesmo repositório:

| Lado | Rota | Quem usa | Onde roda |
| --- | --- | --- | --- |
| **Gestão** | `/gestao` | Equipe interna da Lesco | Só na máquina local |
| **Acervo + tour** | `/` e `/<slug>` | Clientes, arquitetos, especificadores | Vercel, estático e aberto |

A gestão sobe os panoramas, liga os ambientes por pontos de passagem, anota detalhes de
especificação e publica. Publicar gera um pacote estático que vai para a Vercel.

**Público-alvo do lado externo:** arquitetos e especificadores avaliando o produto, e
clientes finais vendo o que foi entregue. O tour é peça de venda e de portfólio.

---

## 2. Estado do projeto

Em produção, com 4 obras publicadas. O código está completo e sem `TODO` pendente; as
lacunas reais são de **conteúdo** e estão detalhadas na seção 12.

Não é repositório git — o `.gitignore` existe, mas `git init` nunca rodou.

---

## 3. Restrições de arquitetura

Decisões tomadas explicitamente pelo dono do produto. Não são acidentes de implementação e
não devem ser revertidas sem pedido dele.

### 3.1 Travadas

- **Editor local, export estático.** O editor roda em `127.0.0.1` na máquina dele. O lado
  público é um pacote estático na Vercel. **Sem backend em nuvem, sem banco de dados, sem
  contas de serviço.**
- **Sem build e sem dependência.** Nenhum `npm install`. O servidor usa só módulos nativos
  do Node; o redimensionamento das fotos acontece no canvas do navegador; o renderer WebGL2
  foi escrito à mão em vez de usar Photo Sphere Viewer. Toda feature nova precisa caber
  nessa regra.
- **Um site com todos os tours**, com capa de acervo e uma pasta por obra — não um pacote
  isolado por tour.
- **Tours sempre abertos**, sem senha e sem login.
- **Sem autenticação no editor**, inclusive no modo rede (`--rede`, que escuta em `0.0.0.0`
  para abrir o tour no celular). A opção com token foi apresentada e recusada; a mitigação
  combinada é o padrão preso a `127.0.0.1`. **Não propor autenticação por conta própria.**
- **Panorama guardado sem recompressão** (decidido em 21/08/2026). O arquivo da câmera vai
  ao disco byte a byte. Motivo dado: não há servidor online no horizonte, então não há
  banda a economizar, e o que o cliente vê no headset tem que ser a foto do equipamento.
- **Tiles multirresolução foram descartados.**

### 3.2 Escopo já recusado

Não reintroduzir sem perguntar:

- **Planta baixa interativa** (minimapa com a posição dos ambientes).
- **Marca customizável por tour** (white-label, logo do cliente).
- **Vínculo com catálogo de produto.** O conteúdo do hotspot de informação é texto escrito
  à mão. Não integrar com as fichas técnicas que existem em outro projeto da empresa.
- **"Experiência completa" dentro do VR** — sem tira de ambientes, sem ficha da obra, sem
  capa do acervo dentro do headset. Em VR só existem passagem e informação.
- **Versão mobile do editor.** Três colunas simultâneas não cabem numa faixa estreita;
  abaixo de 1080px o editor diz isso em vez de entregar uma versão mutilada.

### 3.3 Alvo de VR

- **Meta Quest 2/3/Pro**, via WebXR no navegador do Quest. Não Vision Pro, não PCVR.
- Certificado autoassinado local (`npm run cert` → `npm run dev:vr`), porque WebXR exige
  contexto seguro e o headset é outro aparelho na rede.
- As fotos são **monoscópicas**: há presença e escala reais, mas **não há profundidade
  estereoscópica**. Isso foi alinhado explicitamente. Profundidade real exigiria câmera 360
  estéreo, e daria para acrescentar depois sem refazer o que existe.

---

## 4. Stack

Zero dependências, zero build. O `package.json` não tem `dependencies` nem
`devDependencies`.

- **Servidor** — `server.js`, ~560 linhas, só nativos do Node (`http`/`https`,
  `fs/promises`, `path`, `net`, `os`). Node ≥18, ESM. Porta 4360 (`PORT` sobrepõe).
- **Frontend** — HTML/CSS/JS puro em módulos ES nativos. Sem framework, sem bundler, sem
  transpilação. Fontes do Google (Space Grotesk + Archivo).
- **Renderer** — WebGL2 escrito à mão (`app/js/panorama.js`). Quad de tela cheia com
  fragment shader que calcula a direção do raio por pixel; `textureGrad` com derivada
  corrigida na costura; filtragem anisotrópica ligada.
- **VR** — WebXR nativo (`app/js/vr.js`), sessão `immersive-vr`.
- **Pipeline de imagem** — canvas do navegador (`app/js/imagem.js`). Não há biblioteca
  nativa de imagem no servidor: seria a única coisa a exigir `npm install`.
- **Deploy** — pacote estático em `dist/` para a Vercel. Framework Preset "Other", build e
  install vazios, output `dist`.

### Comandos

```
npm run dev        servidor em 127.0.0.1:4360
npm run dev:rede   escuta em 0.0.0.0 — para abrir no celular na mesma rede
npm run cert       gera o certificado autoassinado (uma vez)
npm run dev:vr     0.0.0.0 + HTTPS — necessário para WebXR no Quest
npm run export     só gera dist/ e sai
```

Só um servidor por vez: subir um segundo é recusado com aviso. Para duas instâncias de
propósito, mudar a porta (`PORT=4361 npm run dev`).

---

## 5. Estrutura de pastas

```
server.js              API do editor + gerador do pacote + servidor estático
index.html             capa do acervo (público)
tour.html              visualizador de tour (público)
gestao/
  index.html           listagem de obras (interno)
  tour.html            editor de tour (interno)
app/css/
  tokens.css           tokens do Lesco Vault + extensão --foto-* deste produto
  base.css             primitivas: .btn .pill .field .card .painel .toast
  panorama.css         palco, hotspots, tira de ambientes, painéis sobre foto
  publico.css          acervo e tour
  gestao.css           editor de três colunas
app/js/
  comum.js             esc/qs/no/debounce/aviso/confirmar + vocabulário do produto
  api.js               cliente REST — só gestão; caminhosDaCena() é a fonte única
                       da convenção de nomes de mídia
  icones.js            SVG inline: icone(nome, tamanho, traco), hidratarIcones()
  imagem.js            as três derivadas, geradas no canvas do navegador
  panorama.js          renderer equirretangular WebGL2 (37 KB)
  hotspots.js          camada de <button> HTML posicionados sobre o canvas
  vr.js                sessão WebXR, marcadores 3D, mira, painel de detalhe
  gestao-lista.js      listagem, criação e exclusão de obras
  gestao-editor.js     editor de três colunas (41 KB, maior arquivo do projeto)
  publico-acervo.js    capa do acervo e filtros
  publico-tour.js      tour público
app/assets/
  logo-lesco.png       o logo que funciona (os SVGs do design system são quebrados)
data/tours/<slug>/
  tour.json            fonte de verdade de cada obra
media/<slug>/          panoramas processados — no .gitignore
dist/                  pacote gerado pelo export — no .gitignore
cert/                  PFX e senha do certificado local — no .gitignore
ferramentas/
  qr.js                codificador de QR próprio — PRONTO E NÃO INTEGRADO
  qr-verifica.js       verificação do codificador acima
  frustum-verifica.js  teste de verdade conhecida da matemática de VR
  gerar-panorama-teste.cjs   panorama sintético para testar o renderer
  gerar-certificado.ps1
  abrir-porta-firewall.ps1
```

`data/` e `media/` são conteúdo, não código.

---

## 6. Modelo de dados

Um arquivo JSON por obra, em `data/tours/<slug>/tour.json`. É a fonte de verdade. O slug é
derivado do nome da obra na criação (`Resort Jurerê` → `resort-jurere`) e **não muda
depois**, mesmo que o nome mude; colisão vira `-2`, `-3`.

```jsonc
{
  "slug": "biotique",              // = nome da pasta, imutável
  "obra": "Biotique",
  "cidade": "São Paulo",
  "uf": "SP",                      // uma das 27 em UFS (comum.js)
  "tipo": "residencia",            // resort | residencia | comercial | corporativo
  "ano": 2026,
  "escritorio": "Setin",           // escritório de arquitetura
  "linhas": [],                    // panel-shield | brise | green-brise (múltiplas)
  "apresentacao": "",              // texto livre, aparece na ficha da obra
  "publicado": true,               // rascunho nunca entra no dist/
  "capaCenaId": "c1",              // fallback: primeira cena da lista
  "cenas": [ /* ver abaixo */ ],
  "criadoEm": "2026-09-01T14:33:27.340Z",
  "atualizadoEm": "2026-09-01T14:35:13.099Z"
}
```

### Cena (um ambiente fotografado)

```jsonc
{
  "id": "c16",                     // c1, c2… sequencial, nunca reaproveitado
  "nome": "Hall de entrada",       // é o rótulo que o visitante lê no ponto de passagem
  "largura": 11904,                // do arquivo original, em px
  "altura": 5952,
  "vistaInicial": {                // por onde o visitante entra no ambiente
    "yaw": 0.046,                  // radianos
    "pitch": 0.776,                // radianos
    "fov": 76                      // graus; FOV_MIN 28, FOV_MAX 100, padrão 76
  },
  "hotspots": [ /* ver abaixo */ ]
}
```

A ordem do array `cenas` é a ordem da tira de ambientes no tour e da lista no editor.

### Hotspot — só existem dois tipos

**Passagem** (`tipo: "navegacao"`) — leva a outro ambiente:

```jsonc
{
  "id": "h11",
  "tipo": "navegacao",
  "yaw": -2.995,                   // posição na esfera, radianos
  "pitch": -0.185,
  "destinoId": "c13",              // id de outra cena; pode ser null = não configurado
  "direcao": "cima-direita"        // para onde a seta aponta
}
```

`direcao` guarda o **nome** da rosa 3×3, não o ângulo: `cima-esquerda`, `cima`,
`cima-direita`, `esquerda`, `direita`, `baixo-esquerda`, `baixo`, `baixo-direita`. O ângulo
sai de `grausDaSeta()`; o ícone é um só, girado por CSS. Guardar o nome mantém o JSON
legível para quem abre o arquivo na mão. Padrão para tour antigo sem o campo: `direita`.

**Informação** (`tipo: "informacao"`) — anota um detalhe de especificação:

```jsonc
{
  "id": "h12",
  "tipo": "informacao",
  "yaw": 0.5,
  "pitch": -0.1,
  "titulo": "Brise Origens 40",    // máx. 70 caracteres
  "texto": "Ripa de 40 mm em Tasmania Oak, montagem vertical com espaçamento de 30 mm."
                                   // máx. 900 caracteres; quebras de linha viram <p>
}
```

Trocar o tipo de um hotspot no editor faz `delete` dos campos do outro tipo, então o JSON
não acumula lixo.

**Passagem só vale num sentido.** Ligar A→B não cria B→A; o caminho de volta é um segundo
hotspot, colocado à mão.

### Índice do acervo

Não é arquivo em disco durante o desenvolvimento: `montarIndice()` varre `data/tours/*` a
cada requisição de `/data/index.json`. Só o export materializa o arquivo.

```jsonc
{
  "geradoEm": "2026-09-01T14:45:19.782Z",
  "tours": [
    {
      "slug": "alpha-one", "obra": "Alpha One", "cidade": "São Paulo", "uf": "SP",
      "tipo": "residencia", "ano": 2026, "escritorio": "Construcompany",
      "linhas": [], "apresentacao": "", "publicado": true,
      "totalCenas": 9,                                  // derivado
      "capaThumb": "/media/alpha-one/c1.thumb.jpg",     // derivado do capaCenaId
      "atualizadoEm": "2026-09-01T14:41:08.799Z"
    }
  ]
}
```

Ordenado por ano decrescente, depois nome (`localeCompare` pt-BR). O caminho da capa é
**derivado** do id da cena, não guardado — a convenção de nomes é única e duplicá-la no
JSON seria estado redundante.

### Vocabulário do produto (`comum.js`)

```js
LINHAS      = [panel-shield "Panel Shield", brise "Brise", green-brise "Lesco Green Brise"]
TIPOS_OBRA  = [resort "Resort", residencia "Residência",
               comercial "Comercial", corporativo "Corporativo"]
```

Ambos são listas fechadas no código. Acrescentar uma linha de produto ou um tipo de obra é
edição de constante, não de dados.

---

## 7. API HTTP (só o editor consome)

Sem autenticação, por decisão. O tour exportado lê JSON estático e **nunca** chama nada
disto — `api.js` sequer vai no pacote.

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` | `/api/tours` | índice completo, incluindo rascunhos |
| `POST` | `/api/tours` | cria obra; exige `obra` não vazio; devolve 201 |
| `GET` | `/api/tours/:slug` | ficha completa |
| `PUT` | `/api/tours/:slug` | grava; `slug` e `criadoEm` vêm da rota/anterior, nunca do corpo |
| `DELETE` | `/api/tours/:slug` | apaga ficha **e** mídia; sem lixeira, sem desfazer |
| `PUT` | `/api/media/:slug/:arquivo` | sobe um dos três derivados; `image/jpeg`; limite 120 MB |
| `DELETE` | `/api/media/:slug/:arquivo` | apaga as **três** derivadas da cena |
| `POST` | `/api/export` | regera `dist/` |

Rotas de página: `/`, `/tour` (dev, com `?t=slug`), `/gestao`, `/gestao/tour`. Estático:
`/app/`, `/data/`, `/media/`, com `resolverDentroDaRaiz()` barrando path traversal.

**Detalhe relevante:** em desenvolvimento `/data/index.json` responde com
`somentePublicados: false` — o acervo local mostra rascunhos. Só o export filtra. É
intencional e está comentado no código, mas significa que o acervo local não é idêntico ao
que vai ao ar.

---

## 8. Imagens: pipeline, armazenamento e entrega

### As três derivadas

Cada foto vira três arquivos em `media/<slug>/`, nomeados a partir do id da cena:

| arquivo | largura | peso típico | qualidade | para quê |
| --- | --- | --- | --- | --- |
| `c1.jpg` | original (11904px nas obras atuais) | 10–25 MB | **sem recompressão** | tela e VR |
| `c1.preview.jpg` | 1536px | ~150 KB | 0.80 | entra primeiro; é a outra ponta do fade na travessia |
| `c1.thumb.jpg` | 480px | ~35 KB | 0.78 | tira de ambientes e capa do acervo |

A completa é o arquivo que saiu da câmera, byte a byte. JPEG de câmera 360 já vem
comprimido; reencodar em cima disso é perda geracional que não volta. Duas exceções, e o
editor avisa quando cai numa delas: **PNG** e **arquivo acima de 120 MB** são reencodados
em qualidade 0.98, ainda sem reduzir a largura.

Se a proporção não for 2:1 o editor aceita mas avisa — a projeção pode distorcer.

O redimensionamento acontece no **canvas do navegador**, em passes sucessivos de redução
pela metade. Um único `drawImage` bilinear direto para 1536 serraria as ripas do brise.

### Onde ficam e como são servidas

- **Em disco:** `media/<slug>/`. Está no `.gitignore` — panorama pesa e os originais moram
  fora do projeto. Volume atual: **706 MB em 4 obras** (biotique 314 MB, alpha-one 183 MB,
  lavvi 119 MB, jha-boutique 90 MB).
- **Em desenvolvimento:** servidas pelo `server.js` na rota estática, com `no-store`.
- **No pacote:** copiadas para `dist/media/`. O `dist/vercel.json` gerado marca
  `/media/(.*)` como `public, max-age=31536000, immutable` — panorama publicado não muda, e
  é onde está todo o peso.
- **Upload:** `PUT /api/media/...`, limite de 120 MB espelhado entre `LIMITE_UPLOAD` no
  servidor e em `imagem.js`.

### Decode no tamanho do teto

O renderer lê largura e altura do cabeçalho do JPEG **antes** de decodificar e pede o decode
direto no tamanho da textura. Virou obrigatório quando a completa passou a ser a original:
decodificar 11904×5952 inteiro para reduzir depois seriam ~286 MB de RGBA vivos de uma vez.
No desktop passa; num Quest 2 é onde a aba morre sem mensagem nenhuma.

O teto de textura também respeita o limite do aparelho — iPhone costuma aceitar 4096px. Sem
essa redução a textura é recusada e a cena fica preta no celular. Em VR o teto é **8192px**,
seja qual for o arquivo em disco, porque ali o limite é memória: 8192×4096 RGBA ocupa
128 MiB, ~171 MiB com mipmap.

---

## 9. Renderização e VR

### Por que renderer próprio

O panorama **não** é uma esfera texturizada: é um quad de tela cheia com um fragment shader
que calcula a direção do raio por pixel. Isso dá duas coisas que importam aqui: nenhum
artefato de tesselação nas ripas do brise, e a travessia entre ambientes vira um mix de duas
texturas no mesmo passe. E deixa os hotspots serem `<button>` de HTML sobre o canvas, então
herdam o design system inteiro e continuam navegáveis por teclado e leitor de tela — coisa
que marcador desenhado dentro da textura não seria.

### Interface do módulo `panorama.js`

`criarPanorama(canvas, opcoes)` devolve:

```
carregar(caminhos, vista, { travessia })   troca de cena, com fade
projetar(yaw, pitch) → { x, y, visivel }   esfera → tela (posiciona os hotspots)
doEcra(x, y) → { yaw, pitch }              tela → esfera (coloca hotspot novo)
definirCamera, zoom, pedirQuadro, desenharVista
ligarGyro() / desligarGyro() / get temGyro
definirModoXR(ligado), destruir()
get camera, arrastouPixels, tetoTextura, gl, vistaCena
```

Os quatro últimos existem porque `vr.js` desenha marcadores no **mesmo** contexto WebGL, com
programa próprio.

### Os hotspots existem duas vezes

Na tela são `<button>` de HTML. Dentro de uma sessão imersiva o DOM não é composto no
headset, só a camada WebGL — então lá eles são redesenhados como quads texturizados, com o
visual pintado num canvas 2D. Duas implementações do mesmo conceito, porque os meios não têm
nada em comum. **Feature nova de hotspot precisa ser pensada nos dois lugares.**

### Armadilha conhecida (não regredir)

Em `raioDeVista` (panorama.js) o deslocamento do centro óptico entra **somando**:
`vx = (ndc.x + P02) / P00`. Com o sinal trocado nada quebra em tela plana, porque ali o
frustum é simétrico e `P02 = 0`; o erro só aparece no headset, e o sintoma é a imagem não
fundir. Custou três rodadas de depuração. Existe teste de verdade conhecida em
`ferramentas/frustum-verifica.js`. **Corolário: teste de tela plana não cobre matemática de
VR.**

---

## 10. Design system

Construído sobre o **Lesco Vault** — mesmos tokens, mesmos componentes, mesma tipografia.
Quem já usa o Vault não reaprende nada.

- Superfícies cinza (`--surface-page: #EEEEEE`), Space Grotesk display + Archivo UI, raios
  de 4/8px, hairlines a 0.5px, degradê de marca em quatro stops (cream/peach/sage/sky).
- Extensão própria deste produto: os tokens `--foto-*` (scrim, chrome, hairline, texto,
  blur, véus de topo e pé) — o vocabulário para UI sobreposta a fotografia.
- Primitivas em `base.css`: `.btn` `.pill` `.field` `.card` `.painel` `.toast`.
- Confirmação destrutiva é painel próprio, não `confirm()` do navegador, e em ação perigosa
  o foco começa em **Cancelar**: um Enter reflexo não deve apagar uma obra.
- **Gotcha:** os SVGs de logo do design system raiz renderizam como retângulo preto (classes
  `cls-1..4` sem bloco `<style>`). O logo que funciona é `app/assets/logo-lesco.png`;
  `filter: brightness(0) invert(1)` gera o lockup branco sobre foto.

---

## 11. Funcionalidades existentes

### Gestão (interno)

- Listagem de obras em cartões, com capa, contagem de ambientes e status de publicação.
- Criar obra: nome, cidade, UF, tipo, ano, escritório. O nome define o endereço público.
- Excluir obra pelo ícone de lixeira do cartão. Apaga ficha e panoramas processados, sem
  desfazer. Se a obra estava publicada, o pacote é regerado para ela sair do acervo na hora.
- Botão **Gerar pacote público** para reconstruir tudo sem mexer em publicação.
- Editor de três colunas: ambientes | panorama | inspetor.
  - Upload arrastando os JPG equirretangulares, um arquivo por ambiente, com progresso das
    três derivadas.
  - Renomear e reordenar ambientes; excluir ambiente com aviso de quantos hotspots
    apontavam para ele.
  - Colocar hotspot clicando no panorama; arrastar para reposicionar; `Esc` cancela a
    colocação.
  - Escolher o destino da passagem e a direção da seta (rosa 3×3).
  - Escrever título e texto do hotspot de informação.
  - **Fixar vista de entrada** — botão explícito. Não é gravado sozinho no enquadramento em
    que a cena foi salva: olhar para trás para posicionar um hotspot não deve mudar por onde
    o visitante entra.
  - Editar a ficha da obra: apresentação, linhas aplicadas, capa.
  - `Ctrl+S` salva. Chave de publicar no topo, que **grava e regera o pacote** na mesma
    ação; fica desligada enquanto o tour não tiver nenhum ambiente, com o motivo escrito ao
    lado.
- Abaixo de 1080px o editor recusa e explica, em vez de entregar versão mutilada.

### Acervo (público)

- Capa com as obras publicadas em grade, capa fotográfica, tipo e ano.
- Filtros por **linha de produto** e por **tipo de obra**, montados só com os valores
  presentes no acervo.

### Tour (público)

- Arrasto com inércia, pinça, roda, setas do teclado, zoom por botão.
- Tira de ambientes na base, com miniatura e nome.
- Travessia entre ambientes com fade de duas texturas no mesmo passe.
- Hotspots como `<button>`: passagem com seta orientada e rótulo do destino, informação com
  painel de detalhe.
- Ficha da obra: apresentação, local, tipo, ano de entrega, arquitetura, nº de ambientes,
  linhas aplicadas.
- Tela cheia.
- **Giroscópio** em aparelho de toque, com mensagem correta quando o contexto não é seguro
  (`DeviceOrientationEvent` exige HTTPS; `http://172.16.x.x` não é isento como `localhost`).
- **Botão VR** quando há suporte a `immersive-vr`.

### VR (Meta Quest)

- Sessão `immersive-vr`, marcadores 3D como quads texturizados, mira, painel de detalhe.
- Anel com seta atravessa; disco claro com "i" abre o detalhe; apontar para fora fecha.
- Gatilho do controlador e pinça de hand tracking funcionam igual.
- Validado em Quest real em 17/08/2026.

### Operação

- Sonda de porta ocupada antes de subir — no Windows, `0.0.0.0` não colide com um bind
  prévio em `127.0.0.1`, e o resultado seriam dois servidores no mesmo `data/` sem erro
  nenhum na tela.
- Endereços IPv4 da máquina impressos ao subir, para não caçar `ipconfig`.
- Geração de certificado e abertura de porta no firewall por script.

---

## 12. Estado real do conteúdo

Quatro obras, todas publicadas, todas de 2026, todas em São Paulo. **30 cenas e 23 hotspots
no total.**

| obra | cenas | hotspots | passagens sem destino | passagens sem volta | sem vista fixada | nome genérico |
| --- | --- | --- | --- | --- | --- | --- |
| biotique | 15 | 23 | 3 | 14 | 7 | 0 |
| alpha-one | 9 | 0 | — | — | 8 | 9 |
| lavvi | 4 | 0 | — | — | 4 | 2 |
| jha-boutique | 2 | 0 | — | — | 0 | 2 |

Leitura disso:

1. **Só `biotique` foi de fato montada.** As outras três são ambientes soltos, sem nenhuma
   navegação — ligados apenas pela tira de ambientes.
2. **Nenhum hotspot de informação existe no produto.** Os 23 são todos de passagem. Toda a
   rota de especificação — título, texto, painel na tela, painel em VR — está construída,
   publicada e nunca foi usada uma vez.
3. **`linhas` e `apresentacao` estão vazios nas 4 obras.** Consequência direta: os filtros
   por linha do acervo nunca renderizam, as tags nunca aparecem, e a ficha da obra sai só com
   os campos automáticos.
4. **13 cenas se chamam "Ambiente N"** — que é exatamente o rótulo que o visitante lê no
   ponto de passagem.
5. **19 das 30 cenas não têm vista de entrada fixada**, então o visitante entra em 0° e pode
   cair olhando para uma parede.

---

## 13. Defeitos e pendências conhecidos

Em ordem de impacto no que está no ar:

1. **Três passagens em `biotique` com `destinoId: null`.** O marcador aparece para o
   visitante rotulado só "Ambiente" e o clique **não faz nada, em silêncio** — tanto em tela
   quanto em VR. O editor sinaliza "Destino não definido", mas nada impede publicar assim.
2. **O pacote publicado está desatualizado.** `biotique/tour.json` foi editado às 18:41 de
   01/09; o último export é de 11:45. O que está em `dist/` não é o que está em `data/`.
3. **14 das 23 passagens de `biotique` são de mão única** — entra e não volta.
4. **`ferramentas/qr.js` está pronto e não integrado a nada.** Um codificador de QR completo
   (GF(256), Reed-Solomon, versões 1–10) com verificador próprio, escrito para não depender
   de serviço externo, sem nenhum `import` no servidor nem no app. Presumivelmente destinado
   a mostrar o endereço da LAN no editor, para abrir o tour no celular sem digitar IP.
5. **Teto de textura em VR não revalidado.** Subiu de 6144 para 8192 em 21/08 e o pico de
   memória da travessia foi de ~106 MiB para ~177 MiB, sem passar pelo Quest 2 desde então.
   Se uma cena morrer sem aviso no headset, o número a baixar é o `8192` em `tetoAtual()`.
6. **Nada valida a integridade do tour antes de publicar** — passagem sem destino, ambiente
   órfão, caminho sem volta, nome genérico, vista não fixada. Tudo isso passa.
7. Cosméticos: o docstring de `enviarMidia` em `api.js` diz `c3.previa.jpg` quando o nome
   real é `.preview.jpg`; `ferramentas/abrir-porta-firewall.ps1` existe mas o README manda
   digitar o `New-NetFirewallRule` na mão.

---

## 14. Restrições a respeitar em qualquer feature nova

- Cabe sem `npm install`? Se exigir biblioteca, não cabe.
- Cabe num pacote **estático**, sem servidor no ar? Tudo que o visitante usa precisa
  funcionar com arquivos servidos de CDN. Não há como gravar nada do lado público.
- Se toca hotspot ou marcador, foi pensado **nas duas** implementações — DOM na tela, quad
  texturizado em VR?
- Se toca memória de textura, foi pensado no **Quest 2**, não no desktop?
- Se muda o schema, tour antigo continua abrindo? O padrão do projeto é campo ausente ter
  valor de fallback (ver `DIRECAO_PADRAO`), não migração.
- Toda a interface é em **português do Brasil**, inclusive nomes de função e variável no
  código. Manter.
