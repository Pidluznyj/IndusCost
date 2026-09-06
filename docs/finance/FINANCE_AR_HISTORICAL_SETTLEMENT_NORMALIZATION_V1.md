# Normalização histórica de baixas administrativas AR — fevereiro/2026

**Política:** `HISTORICAL_SETTLEMENT_NORMALIZATION_V1`  
**Autoridade única:** `src/lib/finance/financeArHistoricalMonthlyAttribution.ts`  
**Helper:** `resolveFinanceArHistoricalMonthlyMovementDate`

## Motivo

`settlementDate` no Nomus é a **data administrativa de baixa**, não necessariamente o dia em que o dinheiro entrou no caixa. Em fevereiro/2026 houve regularização operacional em lote: títulos já recebidos em safras anteriores foram baixados administrativamente, concentrando caixa artificialmente em fevereiro nas linhas do tempo mensais.

Quatro dias foram comprovados por auditoria:

- 2026-02-04
- 2026-02-05
- 2026-02-09
- 2026-02-19

Somente títulos com **lag civil (settlement − due) > 15 dias corridos** nessas datas são normalizados. O `dueDate` vira âncora histórica **nessa exceção**. Demais títulos permanecem no motor normal da superfície.

Isto **não** é regra geral de atraso. Um recebimento em 2026-02-20 com 90 dias de atraso continua no motor normal.

A correção **não** altera dados do Nomus, **não** persiste data corrigida, **não** altera `receiptDate` de comissão e **não** altera o motor genérico dos 3 dias úteis (`resolveFinanceEffectiveSettlementDate` / `resolveFinanceArEffectiveSettlementDate`).

## Onde se aplica

1. Financeiro → Fluxo de Caixa → Linha do tempo mensal → coluna Recebido (`monthlyTimeline`, `dateAxis: "movement"`).
2. Financeiro → Tesouraria → Caixa → Linha do tempo — por mês → coluna Entrou (read model mensal, depois da regra canônica dos 3 dias).

## Onde NÃO se aplica

- `plannedMonthlyTimeline` (eixo `dueDate`)
- Movimento de hoje, drill-down diário, fechamento diário, cenários
- Contas a Receber (cards, aging, YTD, carteira)
- Contas a Pagar
- Comissões / `NomusReceivableReceipt`
- Radar, calendário, forecast, DRE, faturamento

Na Tesouraria, a visão **dia a dia** permanece na regra canônica. A soma dos dias pode divergir da coluna Entrou do mês quando o overlay realoca AR — isso é deliberado.

## Superfícies e data normal

| Superfície | `normalDate` antes do overlay |
|------------|-------------------------------|
| Fluxo de Caixa mensal (movement) | `settlementDate` cru |
| Tesouraria mensal | data efetiva dos 3 dias úteis |

Para títulos do lote com lag > 15, as duas superfícies escolhem o `dueDate` (paridade da **decisão histórica**). Fora do overlay, a Tesouraria continua desacoplada (regra dos 3 dias) — diferença legítima, não maquiada.

## Conservação

O overlay muda só o **mês/data de atribuição**, nunca `amountReceived`. Um título conta uma vez. Valores realocados para 2025 saem de fevereiro/2026 na timeline filtrada em 2026; não são perda — aparecem no ano do `dueDate`.
