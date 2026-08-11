# Avaliação de três repositórios como fonte para a próxima atualização

Data: agosto de 2026 · Avaliados a pedido, com leitura direta dos repositórios.

---

## Resumo executivo

| Repositório | O que é de fato | Licença | Veredito |
|---|---|---|---|
| **Oceananigans.jl** | Modelo de fluidos oceânicos em Julia, GPU | **MIT** | **Adotar — mas na Fase 3**, e como processo separado |
| **electricitymaps-contrib** | *Parsers* em Python, não os dados | **AGPL-3.0** | **Usar o catálogo, não o código** |
| **open-sustainable-technology** | Diretório curado | CC0/CC-BY | **Usar como busca**, não como fonte |

**Nenhum dos três é uma fonte de dados de observação.** Dois são software, um é
uma lista. Isso não os torna inúteis — torna o uso deles diferente do que o
nome sugere.

---

## 1. Oceananigans.jl — o mais valioso, e o mais mal-entendido

**O que é:** simulador de volumes finitos para as equações de Boussinesq
não-hidrostáticas e hidrostáticas, em domínios cartesianos e de casca esférica,
rodando em CPU e GPU. Julia. MIT.

**O que NÃO é:** uma fonte de dados. Ele não entrega o estado do oceano hoje —
ele *simula* um oceano a partir de condições que você fornece.

### Por que importa para este projeto

É exatamente a Fase 3 do roadmap — "modelo próprio". E resolve um problema que
o roadmap ainda não tinha resolvido: a Fase 3 falava em treinar um FNO sobre
ERA5, que é *aprendizado estatístico*. O Oceananigans é **física resolvida**.
Numa banca, os dois defendem coisas diferentes:

- FNO treinado: "aprendi o padrão a partir de reanálise"
- Oceananigans: "resolvi as equações"

O segundo é mais defensável e mais caro. Não são excludentes — o modelo físico
serve de referência (*baseline*) para validar o estatístico.

### O custo real de integração

O repositório é Julia; a plataforma é Node/TypeScript. **Não existe integração
em processo.** As opções honestas:

1. **Offline, exportando campo** *(recomendada)* — roda a simulação fora, exporta
   NetCDF ou os PNG equirretangulares que o `server/png.js` já sabe ler. A
   plataforma nunca vê Julia. Custo de integração: quase zero.
2. **Serviço HTTP em Julia** — mais acoplado, mais frágil, exige manter dois
   ambientes vivos. Só compensa se a simulação for interativa, o que não é o caso.

Nota de escala, do próprio README: para saturar uma GPU como uma V100 o modelo
precisa de **~10 milhões de pontos de grade**. Simulação global de mesoescala
(~10 km) roda a 10 anos simulados por dia **em 16–20 nós**. Isso não é laptop.
Um domínio regional (a costa brasileira, por exemplo) é o recorte viável.

### Citabilidade — o que mais pesa num doutorado

Tem DOI e artigo de referência:

> Wagner, G. L. *et al.* (2025). "High-level, high-resolution ocean modeling at
> all scales with Oceananigans". arXiv:2502.14148, submetido ao *Journal of
> Advances in Modeling Earth Systems*.

Mais o artigo original no JOSS (Ramadhan et al., 2020, doi:10.21105/joss.02018)
e artigos específicos por esquema numérico (WENO vetor-invariante, CATKE,
free-surface split-explicit). Para metodologia, isso é ouro: cada escolha
numérica tem uma referência própria.

---

## 2. electricitymaps-contrib — cuidado com a licença

**O que é:** coleção de *parsers* que coletam produção, intercâmbio e preço de
eletricidade de operadores de rede no mundo todo. Python.

**O que NÃO é:** os dados. O repositório contém o código que busca; o acesso à
API é **comercial** (o próprio FAQ remete a electricitymaps.com). E o frontend
do mapa **deixou de ser open source** — foi reescrito e fechado.

### O problema da licença — leia antes de copiar qualquer linha

O repositório é **AGPL-3.0** desde a v1.5.0. AGPL é copyleft **de rede**: se
você incorporar código dele e servir a aplicação pela internet, é obrigado a
publicar o código-fonte do seu serviço inteiro sob a mesma licença.

Contribuições anteriores ao commit `cb9664f` estavam sob MIT, mas separar o que
é MIT do que é AGPL num repositório de 6.824 commits é trabalho de auditoria
jurídica, não de engenharia.

**Conclusão prática:** não vendorizar parser nenhum.

### O que é aproveitável, e é bastante

Dois arquivos do repositório são **catálogos de endpoints públicos oficiais**:

- `DATA_SOURCES.md` — de onde vem cada dado, por zona de rede
- `EMISSION_FACTORS_SOURCES.md` — fatores de emissão por tipo de usina

Ler esses catálogos para descobrir que *o ONS publica tal série em tal URL* não
é uso de código sob AGPL — é usar uma bibliografia. As fontes citadas são
governamentais e de operadores, com licenças próprias.

### Vale como camada?

Intensidade de carbono da eletricidade tem **ligação física real** com o que a
plataforma já mostra: geração eólica depende do vento, fotovoltaica depende da
irradiância e da nebulosidade. Uma camada de intensidade de carbono ao lado das
camadas de vento e nuvem permitiria a leitura "o vento caiu no Nordeste e a
intensidade de carbono subiu" — que é uma afirmação científica, não decorativa.

Mas há um porém de escopo: intensidade de carbono é **por zona administrativa**
(polígono de operador), não um campo contínuo. Não se interpola, não se advecta.
Exigiria um quarto tipo de codificação visual (coroplético), além dos três que
já existem (suave, faixas, linhas) e dos símbolos pontuais.

---

## 3. open-sustainable-technology — bibliografia, não fonte

Diretório curado de projetos open source em clima, energia, biodiversidade e
recursos naturais. Não fornece dado nenhum.

O valor está no índice. As seções relevantes para esta plataforma:

- **Atmosphere** → Atmospheric Composition and Dynamics · Dispersion and
  Transport · Chemistry and Aerosol · **Meteorological Observation and Forecast**
- **Ocean** → Ocean Models · Ocean Carbon and Temperature · **Ocean and
  Hydrology Data Access**
- **Climate Data** → Standards · **Access and Visualization** · Processing
- **Environmental Satellites**

É onde procurar candidatos a fonte — não onde encontrá-los prontos.

---

## Recomendação, em ordem

### Agora: nada disto

O campo de vento ainda sai do decodificador GRIB2 com valores fisicamente
impossíveis (o guarda em `server/wind.js`, `LIMITE_FISICO = 150`, existe
justamente para recusá-los). Enquanto a camada principal não fecha, acrescentar
fonte é construir andar sobre laje que não curou.

**Ordem honesta:** confirmar o vento com `/api/wind/grib-debug` → depois fonte
nova.

### Curto prazo: o catálogo do Electricity Maps como bibliografia

Ler `DATA_SOURCES.md` para levantar os endpoints oficiais brasileiros (ONS) e
avaliá-los diretamente. Custo: uma tarde de leitura. Risco de licença: zero,
desde que nenhum código seja copiado.

### Fase 3: Oceananigans em domínio regional, offline

É a peça que dá substância científica ao "modelo próprio", e a que rende mais
numa defesa — porque cada escolha numérica tem artigo para citar. Rodar fora,
exportar campo, servir como PNG pelo caminho que já existe.

### Descartar por ora

Intensidade de carbono como camada. A ligação com o tempo é real, mas exige um
tipo de visualização novo (coroplético por zona) num momento em que os três
tipos existentes ainda estão sendo acertados.

---

## Fontes

- [electricitymaps/electricitymaps-contrib](https://github.com/electricitymaps/electricitymaps-contrib) — AGPL-3.0; parsers; API comercial
- [CliMA/Oceananigans.jl](https://github.com/CliMA/Oceananigans.jl) — MIT; arXiv:2502.14148; doi:10.21105/joss.02018
- [protontypes/open-sustainable-technology](https://github.com/protontypes/open-sustainable-technology) — diretório
