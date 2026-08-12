# Renderização do vento — o que foi restaurado e por quê

## O que aconteceu

Entre 11 e 12/08 eu alterei os parâmetros de desenho do vento **seis vezes**,
cada uma perseguindo um relato isolado, e **nunca** comparei com uma versão
boa conhecida. O resultado acumulado:

| | backup 08-08 | o que eu deixei |
|---|---|---|
| espessura do traço | `1,2 + vel × 2,5` (até 3,7 px) | `0,8 + vel × 0,9` (até 1,7 px) |
| opacidade | `0,88` | `0,01 + vel × 0,30` |
| brilho no miolo | presente | removido |
| partículas (degrau 0) | 40.000 | 160.000 |

Passei rodadas raciocinando sobre acúmulo de tinta e **ignorei o canal que o
backup usava**: a ESPESSURA. No backup a largura cresce 2,5× com a velocidade —
é ela que faz vento forte aparecer. Ao apagar isso e mexer só no alfa, deixei o
campo quase invisível, e tentei compensar com cor, que é o canal mais fraco.

Também relatei um "erro de índice" na rampa (`mix(c2, c3, s - 1.0)`). O backup
tem `s - 2.0`, correto: **o bug foi introduzido depois dele**. O defeito era
real, mas não estava na versão boa.

## O que foi restaurado

`src/windGPU.ts` e `src/perf.ts` voltaram integralmente ao backup de 08-08.

## O que foi mantido da versão nova

Só duas coisas, ambas invisíveis abaixo de 40 m/s:

1. **Teto de armazenamento separado da referência de cor.** Eram o mesmo
   número (40). O campo do GFS de 29/07 tem máximo de 67,8 m/s — um ciclone —
   e ele era aplainado em 40 na entrada, destruindo o gradiente da parede do
   olho antes de chegar à tela. Agora guarda até 120 (limite físico) e a cor
   continua saturando em 40.

2. **`lastPeakMs`**: o pico bruto antes do corte. É o número que distingue
   "ciclone categoria 5" (68 m/s) de "GRIB quebrado" (2×10⁷ m/s).

## Testes removidos

`wind-ramp`, `wind-ink` e `wind-escala` testavam PREFERÊNCIAS minhas
(monotonicidade de luminância, modelo de tinta, referência de cor em 26 m/s),
não corretude. Manter testes que reprovam a versão que o usuário escolheu
seria transformar gosto meu em requisito.

O que continua testado e é corretude de verdade: alinhamento de longitude
(`wind-longitude`), convenções de latitude (`wind-grid`), decodificação GRIB2
(`grib2`, `grib53`, `grib-index`) e detecção de circulação (`vorticidade`).
