# Motor oficial de regras — Contas a Receber

Versão: `FINANCE_AR_RULES_ENGINE_VERSION` (`1.0.0`)

## Objetivo

Concentrar as regras oficiais de Contas a Receber (AR) em um único módulo server-side, pronto para consumo futuro por telas, relatórios, gráficos, PDFs e Excel — **sem alterar consumidores existentes nesta fase**.

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `src/lib/financeAccountsReceivableRulesEngine.ts` | Motor principal |
| `src/lib/financeAccountsReceivableRulesEngine.types.ts` | Contratos/tipos |
| `src/lib/financeAccountsReceivableRulesEngine.test.ts` | Testes unitários + compatibilidade |

## Fontes consolidadas (não duplicar lógica divergente)

O motor **delega** aos helpers já auditados:

- `buildFinanceAccountsReceivableDashboard` — cards oficiais da tela Contas a Receber
- `filterFinanceArManagementReportRows` — saneamento gerencial
- `sumFinanceArReceivedBySettlementInPeriod` — recebido YTD (Relatório Executivo)
- `buildAccountsReceivableOpenHorizon` — horizonte financeiro 0–60 dias
- `financeCivilDate` — datas civis sem deslocamento de fuso
- `resolveForwardYearRange` — janela “hoje até 31/12”

## Regras oficiais documentadas

### Total a receber

Σ `amountReceivable` no universo filtrado e saneado (inclui abertos **e** quitados no filtro).

### Recebido no mês / YTD

- **Campo:** `settlementDate` (data de baixa)
- **Valor:** `amountReceived`
- Mesma regra de `receivedThisMonthAmount` no dashboard AR e `sumFinanceArReceivedBySettlementInPeriod` no Relatório Executivo.

> **Pendência conhecida:** Fluxo de Caixa planejado aloca recebido por `dueDate` (`sumArReceivedInPeriod`). Escopo distinto — não é a regra deste motor.

### Em aberto / aging / agenda

- **Campo:** `dueDate` (vencimento, dia civil)
- **Valor:** `balanceReceivable` para títulos não quitados
- Classificação: `classifyFinanceArTitle` (overdue, dueToday, upcoming)

### Com NF / Sem NF

- **Com NF:** `sourceInvoiceId != null` OU `sourceInvoiceNumber` preenchido
- **Sem NF:** ausência de ambos (carteira pré-NF)
- Não confundir com pedido sem NF (domínio SalesOrder)

### Saneamento gerencial

Via `filterFinanceArManagementReportRows`:

1. Grupo interno excluído
2. Títulos fantasma excluídos
3. Stale Nomus (cutoff MAX(syncedAt) − 1h) excluídos
4. Deduplicação pré-NF superseded
5. **Vencidos sem NF excluídos**; futuros sem NF mantidos

### A receber até 31/12 / Estimativa AR do ano

- `openUntilYearEnd`: abertos com vencimento entre hoje (ou início do ano) e 31/12
- `estimatedYearTotal`: `receivedYtd + openUntilYearEnd`

## API principal

```typescript
import { buildFinanceAccountsReceivableRulesResult } from "./financeAccountsReceivableRulesEngine.js";

const result = buildFinanceAccountsReceivableRulesResult(rows, {
  referenceDate: new Date(),
  filters: { status: "all", year: 2026 },
  syncCutoff: null,
});
```

### Funções expostas

| Função | Descrição |
|--------|-----------|
| `buildFinanceAccountsReceivableRulesResult` | Entrada principal — métricas + cards + horizonte + grid |
| `buildAccountsReceivableRulesContext` | Contexto (datas, filtros, YTD) |
| `normalizeAccountsReceivableFilters` | Normaliza filtros |
| `normalizeAccountsReceivableTitle` | Título saneado unitário |
| `classifyAccountsReceivableTitle` | Status calculado |
| `getAccountsReceivableValue` | Valor de métrica por título |
| `getAccountsReceivableDate` | Data por papel (due/settlement/competence) |
| `buildAccountsReceivableMetrics` | Agregação de métricas |
| `buildAccountsReceivableDayBuckets` | Títulos por dia civil |
| `buildAccountsReceivableGridRows` | Payload base para grids/export |
| `explainAccountsReceivableMetric` | Definição explicável |
| `auditAccountsReceivableRules` | Auditoria de finitude/paridade |

## Métricas disponíveis

Ver `FinanceArRulesMetricKey` em `financeAccountsReceivableRulesEngine.types.ts`.

## Testes

```bash
tsx --test src/lib/financeAccountsReceivableRulesEngine.test.ts
```

Inclui teste de compatibilidade com `buildFinanceAccountsReceivableDashboard`.

## Próxima etapa (fora deste escopo)

Integrar consumidores: tela AR, Fluxo de Caixa, Radar Diário, Relatório Executivo, exportações — substituindo chamadas diretas pelo motor.
