# Relatório — Painel Gerencial: Pedidos de Venda e Faturamento

**Data:** 2026-06-05  
**Commit:** _(preenchido após commit)_

---

## 1. Problema identificado

A Visão Executiva misturava indicadores gerais de vários módulos (Nomus, frota, RH, clientes) com KPIs comerciais em layout único, dificultando substituir o BI gerencial por área. Propostas não são fonte confiável para gestão operacional.

---

## 2. Por que propostas foram removidas da visão principal

Propostas representam pipeline/oportunidade. Pedidos de venda (`SalesOrder`) consolidam emissão, valores líquidos e status operacionais. A aba **Funil de Vendas** no dashboard continua usando propostas.

---

## 3. Nova estrutura por abas internas

Endpoint mantido: `GET /api/dashboard/executive-summary`

Payload reorganizado:

```json
{
  "generatedAt": "...",
  "permissions": { "salesOrders": true, "billing": true },
  "tabs": {
    "salesOrders": { ... },
    "billing": { ... }
  },
  "unavailableIndicators": []
}
```

Frontend `/dashboard` → aba **Visão Executiva** → sub-abas:
- **Pedidos de Venda**
- **Faturamento**

Abas **Operação/Financeiro** e **Funil de Vendas** preservadas.

---

## 4. Aba Pedidos de Venda — indicadores e regras

| Indicador | Fonte | Regra |
|-----------|-------|-------|
| Pedidos no ano/mês | `SalesOrder.totalNetValue` | `issueDate` no período; `status != CANCELLED` |
| Ticket médio | calculado | valor emitido no mês ÷ quantidade |
| Carteira aberta | `SUM(totalNetValue)` | não cancelado + sem `nfes.dataProcessamento` |
| Média diária | calculado | valor ÷ dias úteis decorridos (seg–sex) |
| Pedidos atrasados | count + lista | entrega prevista vencida + sem NF + não cancelado |
| Meta / % atingimento | calculado | mesmo mês ano anterior × 1,30 |
| Evolução mensal | gráfico | emissão mês a mês: ano atual vs anterior |
| Status dos pedidos | breakdown | agrupado por `SalesOrder.status` (exceto cancelados) |

**Data de entrega:** campo `expectedDeliveryDate` (origem Nomus `dataEntregaPadrao`).

---

## 5. Aba Faturamento — indicadores e regras

| Indicador | Fonte | Regra |
|-----------|-------|-------|
| Faturamento mês/ano | `SalesOrder.totalNetValue` | NF com `dataProcessamento` no período |
| Mesmo mês ano anterior | idem | período equivalente |
| Meta / atingimento | × 1,30 | sobre faturamento do mês anterior |
| Ticket médio faturado | calculado | faturamento mês ÷ pedidos faturados |
| Média diária faturada | dias úteis | faturamento mês ÷ dias úteis decorridos |
| Evolução mensal | gráfico | faturamento por mês da NF |
| Top clientes | agregação | faturamento no ano por cliente |
| Recentes | lista | últimos pedidos com NF processada |

**Valor base:** `totalNetValue` do pedido (mesma regra CRM/relatórios — não há valor NF separado confiável no schema).

---

## 6. Regras transversais

### Pedido não cancelado
`SalesOrder.status != 'CANCELLED'` (enum Prisma `SalesOrderStatus`).

### NF processada / faturado
Existe elemento em `nomusRawResponse.nfes` com `dataProcessamento` preenchido (DD/MM/YYYY). Helper: `orderIsInvoicedSql`.

### Pedido atrasado
- não cancelado
- sem NF processada
- `expectedDeliveryDate` < hoje

### Carteira aberta
- não cancelado
- sem NF processada

### Meta +30%
`meta = realizado_período_anterior × 1,30` (fator `TARGET_GROWTH_FACTOR = 1.30`).

### Média por dia útil
Segunda a sexta; feriados não considerados nesta fase. Funções em `executiveDashboardWorkdays.ts`.

### Formatação executiva
`executiveDashboardFormatters.ts`:
- inteiros sem `,00`
- moeda 2 casas
- `formatExecutiveCompactCurrency` para cards (`R$ X Mi`, `R$ X mil`)
- percentuais 1–2 casas

Não altera `utils.ts` (precisão fina em custo/produto).

---

## 7. Indicadores para fases futuras

- Status logístico dedicado (não existe no schema)
- Feriados no calendário de dias úteis
- Margem, recompra, por vendedor, Nomus, produção
- Abas Clientes, RH, Frota no painel gerencial

---

## 8. Como adicionar novas abas

1. Criar `src/lib/<nome>DashboardMetrics.ts` com `build<Nome>DashboardTab(now)`.
2. Adicionar tipo em `executiveDashboardTypes.ts` (`tabs.<nome>`).
3. Orquestrar em `executiveDashboardService.ts` com permissão adequada.
4. Criar componente React `Executive<Nome>Tab.tsx`.
5. Registrar sub-aba em `ExecutiveDashboardPanel.tsx`.
6. Adicionar testes de regras puras + `npm run test:dashboard`.

---

## 9. Arquivos alterados

**Novos:** `salesOrdersDashboardMetrics.ts`, `billingDashboardMetrics.ts`, `salesOrderDashboardRules.ts`, `executiveDashboardWorkdays.ts`, `ExecutiveSalesOrdersTab.tsx`, `ExecutiveBillingTab.tsx`, `ExecutiveDashboardCharts.tsx`

**Alterados:** `executiveDashboardTypes.ts`, `executiveDashboardService.ts`, `executiveDashboardFormatters.ts`, `salesOrderInvoicingSql.ts`, `ExecutiveDashboardPanel.tsx`, `executiveDashboardHelpers.test.ts`, `package.json`

---

## 10. Testes executados

- `npx prisma validate`
- `npm run test:dashboard`
- `npm run lint`
- `npm run build`

---

## 11. Limitações conhecidas

- Faturamento depende de `nomusRawResponse.nfes` populado após integração Nomus.
- Um pedido com múltiplas NFes entra no mês da **última** `dataProcessamento`.
- Meta +30% é regra simplificada; ajustes futuros virão via prompts/BI.
- Permissão: `sales_orders.view` ou `reports.view`.

---

*Relatório gerado após implementação das abas Pedidos de Venda e Faturamento.*
