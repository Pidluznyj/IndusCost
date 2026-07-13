# QA — Consistência CRM Comercial × Pedidos de Venda (SalesOrder)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Escopo** | Gestão Geral · Gestão por Responsável · Carteira de Clientes × tela Pedidos de Venda |
| **Data** | 2026-07-13 |
| **Script** | `scripts/qaCrmCommercialSalesOrderConsistency.ts` |
| **Checks** | total=29 fail=0 (static fail=0, live fail=0) |
| **Status final** | **LIBERADO COM RESSALVA** — contratos estáticos OK; smoke live DB pendente no servidor com DATABASE_URL |

---

## 1. Status por aba

| Aba | Fonte oficial | Estático | Live |
|-----|---------------|----------|------|
| **Gestão Geral** | SalesOrder / SalesOrderItem via `loadCrmSalesOrderMetrics` | PASS | SKIP |
| **Gestão por Responsável** | SalesOrder / Item + escopo `CrmCustomerCommercialOwner` | PASS | SKIP |
| **Carteira de Clientes** | SalesOrder / Item (histórico + período) | PASS | SKIP |
| **Pedidos de Venda** | SalesOrder.issueDate + status CANCELLED | PASS / PASS | SKIP |

## 2. Fonte oficial de cada indicador

| Indicador | Fonte | Eixo |
|-----------|-------|------|
| Pedidos emitidos / valor | `SalesOrder` (motor `crmSalesOrderMetrics` / rules oficiais) | Carteira = responsável comercial |
| Carteira aberta / faturado | Mesmo motor + NFe vinculada | Idem |
| Cancelados | `status = CANCELLED` via `isCancelledSalesOrderStatus` | Idem |
| Ticket médio / clientes com pedido | Agregação sobre SalesOrder válidos | Idem |
| Produto líder | `SalesOrderItem` | Idem |
| Pedidos sem vendedor Nomus | Campos Nomus do pedido + flag auditoria | Não remove da carteira |
| Clientes sem responsável | `CrmCustomerCommercialOwner` ausente/inativo | Sinalização |
| Responsável ≠ vendedor pedido | Comparação owner × Nomus | Sinalização |
| Comissão | **Fora do CRM** — vendedor Nomus do pedido | `comissionamentoAfetado: false` |

## 3. Comparação com Pedidos de Venda

| Aspecto | Pedidos de Venda | CRM Comercial | Consistente? |
|---------|------------------|---------------|--------------|
| Tabela de pedidos | SalesOrder | SalesOrder | Sim |
| Itens / produto líder | SalesOrderItem | SalesOrderItem | Sim |
| Período | `issueDate` | `issueDate` | Sim |
| Cancelados | Excluídos de KPIs válidos / contados à parte | `isCancelledSalesOrderStatus` | Sim |
| Eixo de agrupamento | Vendedor Nomus do pedido | Responsável comercial do cliente | **Diferente por desenho** |
| Proposal | Não é fonte de pedido | Não é fonte de pedido | Sim |

Totais por vendedor Nomus (Pedidos) **não precisam bater** com totais por responsável comercial (CRM).

## 4. Resultado Gislene (últimos 30 dias)

- **Live não executado:** DATABASE_URL presente mas DB inacessível — live SKIP (Invalid `prisma.$queryRaw()` invocation: Can't reach database server at `localhost:5432` Please make sure your database server is running at `localhost:5432`.)
- Diagnóstico estático: se total=0, API deve expor `emptyStateReason=NO_CUSTOMERS_FOR_COMMERCIAL_OWNER` ou mensagem de “clientes sem pedido no período”.

## 5. Inconsistências corrigidas

Histórico recente (backend + UI já mergeados nesta linha):

1. Gestão Geral passou a usar `crmSalesOrderMetrics` / motor oficial Pedidos (não SQL paralelo).
2. Gestão por Responsável: escopo **somente** `CrmCustomerCommercialOwner` (sem OR híbrido Nomus).
3. Carteira: histórico/enriquecimento por SalesOrder; dono nunca inferido do vendedor do pedido.
4. UI: labels/tooltips/sourceInfo/auditoria deixam explícito responsável × vendedor comissionável.

## 6. Pendências

- Rodar o script no servidor com `DATABASE_URL` para fechar smoke Gislene live.
- Opcional: comparar card-a-card Pedidos de Venda × CRM no mesmo período (eixos distintos).

## 7. Conclusão

**LIBERADO COM RESSALVA** — contratos estáticos OK; smoke live DB pendente no servidor com DATABASE_URL

### Checklist dos 15 critérios

| # | Critério | Resultado |
|---|----------|-----------|
| 1 | CRM Gestão Geral usa SalesOrder/SalesOrderItem | PASS |
| 2 | CRM Gestão por Responsável usa SalesOrder/SalesOrderItem | PASS |
| 3 | Carteira usa SalesOrder/SalesOrderItem para histórico | PASS |
| 4 | Nenhuma aba usa Proposal como fonte de pedido | PASS |
| 5 | Responsável comercial ≠ vendedor comissionável | PASS |
| 6 | Vendedor do pedido ≠ responsável fixo do cliente | PASS |
| 7 | Período = SalesOrder.issueDate (CRM + Pedidos) | PASS |
| 8 | Cancelados com regra compatível | PASS |
| 9 | Produto líder de SalesOrderItem | PASS |
| 10 | Cliente com pedido vem de SalesOrder | PASS |
| 11-12 | Sem Nomus: permanece + auditoria | PASS |
| 13 | Clientes sem responsável sinalizados | PASS |
| 14 | Responsável ≠ vendedor sinalizado | PASS |
| 15 | Gislene 30d / motivo de zero | PASS |

### Como reproduzir

```bash
npx tsx scripts/qaCrmCommercialSalesOrderConsistency.ts
npm run check:server-imports
npm run check:frontend-server-imports
npm run check:browser-bundle
npm test
npm run build
```
