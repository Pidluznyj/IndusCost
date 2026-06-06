# Correção — Visão Executiva baseada em Pedidos de Venda

**Data:** 2026-06-05  
**Commit:** _(preenchido após commit)_

---

## 1. Problema identificado

Na aba **Visão Executiva** (`/dashboard`), indicadores comerciais principais vinham de **propostas** (`Proposal`), exibindo valores como:

- Propostas abertas: `1.027,00` (contador formatado com 2 casas decimais)
- Pipeline aberto: `R$ 8.917.179,210019` (6 casas decimais herdadas de `formatNumber`/`formatCurrency` em `utils.ts`)

Propostas ainda não são a fonte confiável de informação comercial do negócio nesta fase. O dashboard gerencial deve refletir **Pedidos de Venda** (`SalesOrder`).

---

## 2. Por que propostas não são a fonte principal

- Propostas representam pipeline/oportunidade, não faturamento ou emissão realizada.
- A aba **Funil de Vendas** continua usando propostas (inalterada).
- Pedidos de venda consolidam valores líquidos (`totalNetValue`) e status operacionais reais.
- Faturamento reconhecido segue NFe com `dataProcessamento` em `nomusRawResponse.nfes`, alinhado ao CRM comercial e relatórios.

---

## 3. Indicadores trocados para pedidos de venda

| Indicador | Fonte anterior | Fonte atual |
|-----------|----------------|-------------|
| KPI overview “Propostas abertas” | `Proposal` count | **Removido** |
| KPI overview principal comercial | `ordersNetThisMonth` (valor emitido) | **Pedidos do mês** (count) + **Faturamento líquido** (NFe) |
| Pipeline aberto | `Proposal.totalNetValue` | **Removido** |
| Propostas abertas/aprovadas/rejeitadas | `Proposal` | **Removidos** da seção comercial |
| Faturamento líquido do mês | `SUM(totalNetValue)` por `issueDate` | **`SUM(totalNetValue)` com NFe `dataProcessamento` no mês** |
| Pedidos faturados no mês | _(ausente)_ | **COUNT** com NFe `dataProcessamento` no mês |
| Ticket médio | valor emitido / pedidos | **`totalNetValue` emitido / pedidos emitidos** (issueDate) |
| Pedidos em aberto | `SalesOrder` DRAFT/READY_TO_SEND | Mantido |
| Enviados ao Nomus | `SalesOrder` SENT_TO_NOMUS | Mantido |

---

## 4. Fonte de cada indicador comercial

| Indicador | Tabela/campo | Filtro |
|-----------|--------------|--------|
| Pedidos emitidos no mês | `SalesOrder` | `issueDate` no mês, `status != CANCELLED` |
| Valor emitido no mês | `SalesOrder.totalNetValue` | mesmo filtro (usado no ticket médio) |
| Faturamento líquido do mês | `SalesOrder.totalNetValue` | NFe em `nomusRawResponse.nfes` com `dataProcessamento` no mês |
| Pedidos faturados no mês | `SalesOrder` | mesmo critério de NFe |
| Ticket médio | calculado | `valor emitido / pedidos emitidos` |
| Pedidos em aberto | `SalesOrder.status` | `DRAFT`, `READY_TO_SEND` |
| Enviados ao Nomus | `SalesOrder.status` | `SENT_TO_NOMUS`, não cancelados |

SQL de faturamento reutiliza a mesma regra do CRM (`salesOrderInvoicingSql.ts`), espelhando `orderIsInvoicedSql` / `nfeProcessamentoDateSql` de `server.ts`.

---

## 5. Regras de período e faturamento

- **Período comercial (emissão):** `SalesOrder.issueDate` entre início e fim do mês corrente (timezone local do servidor).
- **Faturamento realizado:** existe NFe em `nomusRawResponse.nfes` com `dataProcessamento` parseável (DD/MM/YYYY) dentro do mês.
- **Exclusão:** pedidos `CANCELLED` não entram em nenhum indicador comercial.
- **Comparativo mês anterior:** pedidos emitidos e faturamento líquido do mês anterior (mesmas regras).

---

## 6. Regra de formatação aplicada

Novos helpers em `executiveDashboardHelpers.ts` (somente dashboard executivo):

| Função | Regra | Exemplo |
|--------|-------|---------|
| `formatExecutiveInteger` | 0 casas decimais | `1.027` |
| `formatExecutiveCurrency` | 2 casas fixas | `R$ 8.917.179,21` |
| `formatExecutiveDecimal` | máx. 2 casas | `123,46` |
| `formatExecutivePercent` | 1 ou 2 casas | `12,3%` |

`formatNumber` / `formatCurrency` em `utils.ts` **não foram alterados** (precisão fina mantida em composição/custo).

---

## 7. Indicadores removidos/alterados

**Removidos da Visão Executiva:**
- Propostas abertas (overview e bloco comercial)
- Pipeline aberto
- Propostas aprovadas/rejeitadas
- Alerta “Propostas em pipeline”

**Alterados:**
- Overview: Pedidos do mês, Faturamento líquido (NFe), Clientes ativos, Veículos em uso/manutenção, Alertas
- Bloco Comercial: 6 cards baseados em pedidos

**Preservados:**
- Aba Funil de Vendas (propostas)
- Link rápido “Propostas” (se `proposals.view`)

---

## 8. Limitações conhecidas

- Pedidos com entrega futura/atrasados: sem regra confiável existente — não implementados.
- Faturamento depende de `nomusRawResponse.nfes` populado após envio Nomus.
- Usuário sem `sales_orders.view` / `reports.view` não vê bloco comercial (mensagem de indisponível).
- Ticket médio usa valor **emitido** no mês, não faturado.

---

## 9. Validações executadas

- `npx prisma validate`
- `npm run test:dashboard`
- `npm run lint`
- `npm run build`

---

## 10. Arquivos alterados

- `src/lib/salesOrderInvoicingSql.ts` _(novo)_
- `src/lib/executiveDashboardHelpers.ts`
- `src/lib/executiveDashboardService.ts`
- `src/lib/executiveDashboardTypes.ts`
- `src/lib/executiveDashboardHelpers.test.ts`
- `src/components/dashboard/ExecutiveDashboardPanel.tsx`

---

*Relatório gerado após correção da fonte comercial e formatação executiva.*
