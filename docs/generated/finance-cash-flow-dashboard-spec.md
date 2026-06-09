# Especificação — Dashboard Fluxo de Caixa

**Projeto:** IndusCost  
**Branch:** `main`  
**Data:** 2026-06-09  
**Fase:** 1 — Visão Geral (KPIs + gráfico mensal)

---

## 1. Conceito de negócio

Fluxo de caixa **não é faturamento**. Faturamento (`SalesOrder` / NF-e) mede venda/nota; fluxo de caixa mede **entrada e saída de dinheiro** prevista ou realizada.

| Conceito | Fonte | Campo de data | Campo de valor |
|----------|-------|---------------|----------------|
| Entrada prevista | `NomusAccountsReceivable` | `dueDate` | `balanceReceivable` (aberto) |
| Entrada realizada | `NomusAccountsReceivable` | `settlementDate` | `amountReceived` |
| Saída prevista | `NomusAccountsPayable` | `dueDate` | `balancePayable` (aberto, positivo) |
| Saída realizada | `NomusAccountsPayable` | `paymentDate ?? settlementDate` | `amountPaid` |

**Não usar:** `SalesOrder`, `NomusNfe` como fonte principal de caixa (apenas contexto futuro em Faturamento).

---

## 2. Fontes de dados

### NomusAccountsReceivable (entradas)

| Campo | Uso no fluxo |
|-------|--------------|
| `dueDate` | Data base vencimento (previsto) |
| `settlementDate` | Data base baixa (realizado) |
| `competenceDate` | Data base emissão/competência |
| `balanceReceivable` | Valor previsto (título aberto) |
| `amountReceived` | Valor realizado |
| `companyName`, `personName`, `personCnpj` | Filtros |
| `paymentMethodName`, `bankAccountName` | Filtros avançados |
| `sourceInvoiceId`, `sourceInvoiceNumber` | Filtro NF emitida |
| `suspendCollection` | Excluído do previsto quando suspenso |
| `syncedAt` | Última sync (header) |

### NomusAccountsPayable (saídas)

| Campo | Uso no fluxo |
|-------|--------------|
| `dueDate` | Data base vencimento (previsto) |
| `paymentDate`, `settlementDate` | Data base baixa (realizado) |
| `competenceDate` | Data base emissão/competência |
| `balancePayable` | Valor previsto (positivo internamente) |
| `amountPaid` | Valor realizado |
| `suspendPayment` | Excluído do previsto quando suspenso |
| Demais campos | Espelham AR |

---

## 3. Regras de cálculo

### 3.1 Modos de visão (`viewMode`)

| Modo | Entradas | Saídas |
|------|----------|--------|
| `projected` | Saldo aberto AR por vencimento | Saldo aberto AP por vencimento |
| `realized` | `amountReceived` por baixa | `amountPaid` por pagamento |
| `combined` | Previsto + realizado no mesmo bucket mensal | Previsto + realizado no mesmo bucket |

### 3.2 Data base (`dateBase`)

| Valor | AR | AP |
|-------|----|----|
| `due` | `dueDate` | `dueDate` |
| `settlement` | `settlementDate` | `paymentDate ?? settlementDate` |
| `issue` | `competenceDate` | `competenceDate` |

No modo `projected`, a data base efetiva é sempre `dueDate` (independente do filtro).

### 3.3 Fluxo líquido e saldo acumulado

```
netFlow[m] = inflow[m] - outflow[m]
accumulated[m] = accumulated[m-1] + netFlow[m]
```

**Exceção:** saldo inicial bancário = 0 (não há ledger bancário no sistema). Rotulado com `FINANCE_CASH_FLOW_PROJECTED_BALANCE_SCOPE`.

### 3.4 Meses futuros

No ano corrente, meses **após** o mês de referência retornam `null` no modo `realized` (não zero falso). No modo `projected`, meses futuros podem ter valores de títulos em aberto.

### 3.5 Valores AP

Armazenados como **positivos** no payload (`outflowAmount`). Na UI, exibidos como saída (sinal visual negativo / cor vermelha).

---

## 4. Motor gerencial de posição líquida e necessidade de caixa

### 4.1 Posição líquida de caixa (carteira em aberto)

```
netCashPosition = totalReceivableOpen - totalPayableOpen
netCashPositionAbs = |netCashPosition|
netCashPositionStatus = surplus  (se >= 0)
                      | deficit  (se < 0)
netCashPositionLabel = "Superávit projetado" | "Déficit projetado"
```

| Campo | Regra |
|-------|-------|
| `cashCoverageRatio` | `totalReceivableOpen / totalPayableOpen` quando pagar > 0; `null` se pagar = 0 |
| `cashNeedAmount` | `netCashPositionAbs` em déficit; `0` em superávit |
| `cashNeedLabel` | `"Necessidade de caixa"` \| `"Folga projetada"` |

Implementação: `buildNetCashPositionMetrics` em `financeCashFlowIntelligence.ts`.

### 4.2 Série mensal para gráfico principal

Por mês (`monthlySeries[]`):

| Campo | Regra |
|-------|-------|
| `inflowAmount` | AR no mês |
| `outflowAmount` | AP no mês (positivo no payload) |
| `netFlowAmount` | inflow − outflow |
| `accumulatedBalance` | acumulado do fluxo líquido |
| `status` | `positive` se net ≥ 0; `negative` se net < 0; `null` em meses futuros sem dado (realizado) |

### 4.3 Leitura executiva (`executiveReading`)

Frases determinísticas geradas por `buildCashFlowExecutiveReading` — sem LLM externo. Cobre déficit/folga, vencidos AR/AP, meses negativos e concentração (> 40% em cliente/fornecedor).

---

## 5. KPIs — Resumo executivo (UI)

| KPI | Campo |
|-----|-------|
| Posição líquida de caixa | `cards.netCashPosition` + hero |
| Total a receber | `cards.totalReceivableOpen` |
| Total a pagar | `cards.totalPayableOpen` |
| Necessidade / Folga de caixa | `cards.cashNeedLabel` + `cashNeedAmount` ou `netCashPositionAbs` |
| Meses com saldo negativo | `cards.negativeBalanceMonthsCount` |
| Vencidos no caixa | `cards.overdueCashImpact` |

Campos auxiliares de período: `netFlowAmount`, `accumulatedBalance`, `outflowToInflowPercent`.

---

## 6. Gráfico principal

**Título:** Posição Líquida Mensal — Receber x Pagar

| Série | Visual | Campo |
|-------|--------|-------|
| Posição líquida | Barras verdes acima / vermelhas abaixo do zero | `monthlySeries[].netFlowAmount` |
| Saldo acumulado | Linha azul | `monthlySeries[].accumulatedBalance` |

Altura fixa `FINANCE_CASH_FLOW_CHART_HEIGHT = 280` — evita colapso do `ResponsiveContainer`.

Tooltip: mês, a receber, a pagar, posição líquida, saldo acumulado.

---

## 7. Filtros

### Principais (sempre visíveis)

- Ano, Mês, Empresa
- Visão: Previsto / Realizado / Previsto x Realizado
- Data base: Vencimento / Baixa / Emissão
- Status: Todos / Aberto / Pago / Vencido

### Avançados (colapsáveis)

- Cliente, Fornecedor, CNPJ/CPF
- Forma de pagamento, Conta bancária
- NF emitida?

### UX

- Draft/applied com chips, Aplicar/Limpar, pending changes
- Export usa filtros **aplicados**

---

## 8. Abas internas

| Aba | Fase |
|-----|------|
| Visão Geral | **1 — implementada** |
| Calendário | 2 — planejada |
| Acumulado | 2 — planejada |
| Detalhado | 2 — planejada |
| Entradas | 2 — planejada |
| Saídas | 2 — planejada |
| Risco de Caixa | 2 — planejada |

---

## 9. API

| Endpoint | Builder | Fonte |
|----------|---------|-------|
| `GET /api/finance/cash-flow/dashboard` | `buildFinanceCashFlowDashboard` | AR + AP |
| `GET /api/finance/cash-flow/export` | `buildFinanceCashFlowExportCsv` | AR + AP |

---

## 10. Exceções rotuladas

| Constante | Texto |
|-----------|-------|
| `FINANCE_CASH_FLOW_PROJECTED_BALANCE_SCOPE` | Saldo projetado — não considera saldo bancário inicial |
| `FINANCE_CASH_FLOW_SYNC_SCOPE` | Última sync — MAX(syncedAt) global AR/AP |
| `FINANCE_CASH_FLOW_NOT_BILLING_SCOPE` | Fluxo de caixa ≠ faturamento — fonte AR/AP |
| `FINANCE_CASH_FLOW_COMBINED_SCOPE` | Modo combinado — soma previsto e realizado no período |

---

## 11. Pendências (fases posteriores)

1. Calendário diário de caixa
2. Tabela detalhada consolidada AR/AP
3. Saldo bancário inicial configurável
4. Centro de custo / classificação (quando disponível no Nomus)
5. Integração contextual com Faturamento (link diagnóstico, sem misturar fontes)

---

*Gerado pela especificação do dashboard Fluxo de Caixa — IndusCost.*
