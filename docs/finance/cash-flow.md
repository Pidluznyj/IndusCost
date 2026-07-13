# Fluxo de Caixa — regras oficiais

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Atualizado** | 2026-07-13 |
| **Rota UI** | Financeiro → Financeiro / Fluxo de Caixa |
| **Endpoint principal** | `GET /api/finance/cash-flow/daily-radar` |

## Regras oficiais mantidas

Este documento cobre apenas o **drilldown analítico** (radar diário / período personalizado). A alteração recente **não** modifica:

- Regra oficial de Contas a Pagar
- Regra oficial de Contas a Receber
- Regra oficial de Fluxo de Caixa
- Relatório Presidencial
- Sync Nomus (AR / AP / NF / SO)
- Módulo de Comissões

Toda a agregação nova é **read-only**, reutilizando os títulos que já aparecem nos grids.

## Regra de data — Contas a Pagar no Fluxo de Caixa

**Data de Vencimento** (`NomusAccountsPayable.dueDate`) é o eixo oficial de competência / filtro / agrupamento do AP dentro do Fluxo de Caixa. Não usar data de baixa / pagamento / agendamento como eixo principal, salvo se a tela explicitar outro modo.

O drilldown expõe cada linha AP com `vencimentoOficial` + `dataUsadaNoFluxo`, e as agregações abaixo respeitam sempre `dataUsadaNoFluxo` (que é `vencimentoOficial` na visão `projected`).

## Centros de custo no drilldown do Fluxo de Caixa

Nova seção abaixo dos grids de **Contas a Pagar** e **Contas a Receber**:

- **Título:** "Centros de custo das saídas"
- **Subtítulo:** "Distribuição dos pagamentos do período selecionado, respeitando os filtros do drilldown."

### Endpoint

`GET /api/finance/cash-flow/daily-radar/cost-centers` — parâmetros idênticos ao `/daily-radar` (herdados via `buildDailyRadarQuery`):

- `range` — faixa selecionada (`0-7`, `8-15`, …, `custom`)
- `customStartDate` / `customEndDate` — período personalizado
- `day` — dia clicado no carrossel
- `search` — busca textual (fornecedor, empresa, descrição, documento)
- `baseDate` — data de referência

Retorna:

```jsonc
{
  "ok": true,
  "items": [
    {
      "costCenterId": "…",
      "code": "OP-001",
      "name": "Operações",
      "amount": 12345.67,
      "titlesCount": 8,
      "sharePercentage": 42.11,
      "status": "ACTIVE",
      "unclassified": false
    },
    { "costCenterId": "__UNCLASSIFIED__", "name": "Sem centro de custo", ... }
  ],
  "totalAmount": …,
  "totalTitles": …,
  "totalTitlesWithAllocation": …,
  "unclassifiedAmount": …,
  "unclassifiedTitles": …,
  "scope": { "level": "custom", "dateFrom": "…", "dateTo": "…", "day": null, "search": null }
}
```

Detalhe por centro:

`GET /api/finance/cash-flow/daily-radar/cost-centers/titles?costCenterId=<uuid|__UNCLASSIFIED__>&…` — devolve os títulos AP daquele bucket para o mesmo escopo (drawer).

### Regras de agregação

1. Fonte única: os títulos AP retornados pelo `selectedDetail.payables` do próprio radar diário (mesma filtragem de faixa/dia/período/busca já aplicada no grid de Contas a Pagar).
2. Classificação: `AccountsPayableCostCenterAllocation` (mesma tabela usada em `Centro de Custo → Centro de Custo`).
3. Item **sem alocação** ou com alocação parcial → bucket `Sem centro de custo` (auditoria).
4. `AR` **nunca** é adicionado à agregação por centro. Se um dia surgir eixo formal de AR × CC, sai como card separado.
5. Percentual = valor do card / total das saídas do escopo.
6. Ordenação: valor desc; `Sem centro de custo` sempre no final.

### Interação

Card → drawer lateral com os títulos AP do centro (fornecedor, descrição, empresa, vencimento oficial, valor, status). Não altera os grids principais, não altera dados.

### Estados

| Estado | Texto |
|--------|-------|
| Loading | "Carregando centros de custo..." |
| Vazio | "Nenhuma saída com centro de custo encontrada para o filtro atual." |
| Erro | "Não foi possível carregar os centros de custo do período." |
| Sem classificação | Card "Sem centro de custo" com valor + total de títulos |

### QA / diagnóstico

- `npm run qa:cash-flow-cost-centers` — QA estático + unit.
- `npx tsx tmp-audits/inspect-cash-flow-cost-center-drilldown.ts [--start=YYYY-MM-DD --end=YYYY-MM-DD] [--day=YYYY-MM-DD]` — imprime período, total de saídas, agregado por centro, diferença esperada 0 e top 20 centros.

### Permissões

Herdadas de `FINANCE_CASH_FLOW_VIEW_PERMISSIONS` (`finance.view`, `finance.accountsPayable.view`, `finance.accountsReceivable.view`, `reports.view`, `settings.nomus.view`, `settings.view`).
