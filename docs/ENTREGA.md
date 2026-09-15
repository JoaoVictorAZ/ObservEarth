# O que é entregue, e como

**Você não entrega um zip. Você entrega um link** para um repositório público no
GitHub. A avaliação abre o link, lê `docs/MVP.md` e olha os screenshots.

> Isto é o que o roadmap registrou do enunciado (M6 e R8). **Confira o item 5 do
> enunciado** antes de submeter — ele é a autoridade, este arquivo é só o mapa.

---

## 1. O que vai no repositório

| O quê | Onde | Para que serve na avaliação |
|---|---|---|
| **O documento** | `docs/MVP.md` | É o item avaliado. Sete tópicos, títulos exatos. |
| **O catálogo de dados** | `pipeline/contrato/esquema.md` e `.json` | *Modelagem e Catálogo* (2,0 pt) |
| **O validador do contrato** | `pipeline/contrato/validar.mjs` | mostra que o catálogo é executável, não decorativo |
| **Os notebooks** | `pipeline/notebooks/*.py` | *Pipeline de Dados* |
| **A lógica testada** | `pipeline/*.py` | *Carga*, *Qualidade*, *Análise* |
| **Os testes** | `test/*.mjs`, `pipeline/test_*.py` | *Capricho* |
| **Os screenshots** | `docs/imagens/` | prova do que rodou na nuvem |
| **O aplicativo** | `src/`, `server/` | mostra que o pipeline não é exercício solto |

Os notebooks estão em **formato-fonte do Databricks** (`.py`) de propósito: no
GitHub aparecem como código legível. Um `.ipynb` apareceria como JSON com
imagens em base64, e ninguém lê isso.

## 2. O que NÃO vai

`data/bronze/` — 1,3 GB de CSV do INMET. Já está no `.gitignore`.
`data/silver/`, `data/gold/*.parquet` — saída do pipeline, reproduzível.

**Ninguém entrega dado bruto.** Entrega o código que o busca: `tools/baixar-inmet.mjs`
faz o download inteiro e é reproduzível por quem corrigir.

**Exceção:** `data/gold/estacoes.json`, ~200 kB. Vai junto para o aplicativo
subir completo sem ninguém precisar baixar 1,3 GB.

**E o `.env` NUNCA vai.** Ele tem as suas chaves de API. Está no `.gitignore`, e
`npm run checar-entrega` confirma isso antes de você publicar — porque chave em
repositório público está comprometida no instante em que sobe.

---

## 3. Publicar

```powershell
# 1. Confira ANTES de subir. Ele checa o documento, o catálogo, e que nenhum
#    segredo nem dado bruto está no caminho de ir junto.
npm run checar-entrega

# 2. Crie o repositório em github.com/new — PÚBLICO, sem README nem .gitignore
#    (já temos os dois).

# 3. Publique
git add -A
git commit -m "Patch MVP: pipeline de dados em camadas + camada de estações"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/observearth.git
git push -u origin main
```

Se `git remote add` reclamar que `origin` já existe:
`git remote set-url origin https://github.com/SEU-USUARIO/observearth.git`

**Depois do push, abra o link numa janela anônima.** Se o repositório estiver
privado, a página dá 404 — e é melhor descobrir isso agora do que na correção.

---

## 4. O que ainda falta

- [ ] Rodar os três notebooks no Databricks (`docs/DATABRICKS.md`)
- [ ] Screenshots em `docs/imagens/`
- [ ] Preencher os `⟨PENDENTE — execução real⟩` de `docs/MVP.md`
- [ ] `npm run checar-entrega` sem pendências
- [ ] Repositório público e o link aberto em janela anônima

Opcionais, se sobrar tempo — não sustentam a nota, sustentam o diferencial:

- [ ] M4: `python pipeline/parear_era5.py --limite 50 --saida data/pares`
- [ ] M8: viés e recorde na sonda
- [ ] M9: camada de confiança no mapa

---

## 5. Sobre os `⟨PENDENTE⟩`

O documento declara, na primeira seção, que **todo número é medido ou está
marcado como pendente**. Isso não é formalidade: é o que separa a entrega de um
relatório genérico, e é o que a autoavaliação usa para ser honesta.

Então: **preencha com o que os notebooks imprimirem, ou deixe marcado.** Um
número estimado que parece medido é pior que um campo vazio — o campo vazio
você vê, a estimativa você esquece que inventou.
