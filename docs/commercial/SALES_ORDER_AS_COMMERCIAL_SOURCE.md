# Pedido de Venda como fonte comercial principal

**Data:** 2026-06-12  
**Status:** Migração Fases 0–8 concluída

---

## 1. Regra final

```text
Pedido de Venda (SalesOrder) = base principal comercial.
Proposta (Proposal)         = pré-venda, negociação, impressão, CRUD e geração de pedido.
```

Visão comercial, CRM gerencial, CRM vendedor e relatórios comerciais globais usam **Pedidos de Venda**.

Propostas **não** são base de venda, receita, cliente ativo, ABC, recompra, pipeline principal ou saúde comercial nos dashboards globais.

---

## 2. Endpoints migrados para SalesOrder

| Endpoint | Uso comercial |
|----------|----------------|
| `GET /api/customers/:id/commercial-360` | Histórico, ABC, mix — `salesOrder.findMany` + `buildPortfolioAbcFromSalesOrders` |
| `GET /api/crm/customers/:customerId/commercial-intelligence` | Cockpit do cliente |
| `GET /api/crm/management-dashboard` | Dashboard gerencial |
| `GET /api/crm/seller-dashboard` | Dashboard do vendedor |
| `GET /api/customers/indicators` | Indicadores (`withSalesOrderCount`) |
| `GET /api/admin/seller-options` | Opções de vendedor (`source: "sales_orders"`) |
| `GET /api/dashboard` (Visão Executiva) | KPIs comerciais principais |
| `GET /api/reports/data` | KPIs comerciais em relatórios |
| `GET /api/products/material-demand/*` | Demanda MP (pedidos) |
| `GET /api/sales-orders/material-demand/*` | Demanda MP (pedidos) |

Atividades comerciais aceitam `salesOrderId` além de `proposalId` (`CommercialActivity`).

---

## 3. O que continua usando Proposta legitimamente

| Uso | Classificação |
|-----|----------------|
| CRUD `/api/proposals` | Módulo Propostas (pré-venda) |
| `POST /api/proposals/:id/generate-sales-order` | Operacional proposta → pedido |
| Indicadores do módulo Propostas (`ProposalIndicatorsDashboard`) | Análise de pipeline pré-venda |
| Funil de Vendas (aba dashboard) | Pipeline de oportunidades |
| `CommercialActivity.proposalId` | Vínculo histórico de atividade |
| Sync Nomus de propostas | Integração legítima |

---

## 4. Motor legado (deprecated)

| Arquivo | Conteúdo |
|---------|----------|
| `src/lib/customerCommercialProposalLegacy.ts` | `computeCommercialPhase2`, `ProposalIntelSlice`, ABC por propostas APPROVED |
| `src/lib/customerCommercialIntel.ts` | Reexport shim `@deprecated` — não usar em código novo |

**Runtime ativo:** `computeCommercialPhase2FromSalesOrders` em `customerCommercialSalesOrderView.ts`.

Nenhum endpoint em `server.ts` chama `computeCommercialPhase2(`.

---

## 5. Critérios de pedido válido (métricas comerciais)

Regras canônicas em `src/lib/crmCommercialOrderRules.ts` e `src/lib/salesOrderDashboardRules.ts`:

- **Excluídos de métricas:** `status` = `CANCELLED` ou `ERROR`
- **Receita/ABC:** soma de `totalNetValue` em pedidos válidos por cliente
- **Faturamento:** NFe com `dataProcessamento` em `nomusRawResponse.nfes`

---

## 6. Critérios de carteira aberta

Pedido em carteira aberta quando:

- Status válido para métricas (`DRAFT`, `READY_TO_SEND`, `SENT_TO_NOMUS`)
- **E** sem faturamento reconhecido (sem NFe com `dataProcessamento`)

Funções: `isOpenPortfolioOrder`, `crmOpenPortfolioOrderSql`.

---

## 7. Follow-up por salesOrderId

- `CommercialActivity.salesOrderId` (migration `20260612120000_commercial_activity_sales_order_id`)
- Detecção de pedido sem follow-up: `crmOrderFollowUp.ts` / `crmOrderHasFollowUpExistsSql`
- Atividades podem vincular pedido ou cliente; follow-up considera `updatedAt`/`issueDate` do pedido

---

## 8. Permissões legadas

| Legada | Canônica | Notas |
|--------|----------|-------|
| `proposals.material_report.view` | `reports.material_demand.view` | Relatório de demanda MP; ambas aceitas em `MATERIAL_DEMAND_VIEW_PERMISSIONS` |

Arquivo: `src/lib/commercialMaterialDemandPermissions.ts`.

---

## 9. Riscos conhecidos

- Faturamento depende de `nomusRawResponse.nfes` populado após envio Nomus
- `SalesOrdersIndicatorsDashboard` ainda agrega no client (INT-007) — divergência potencial vs `/api/reports/data`
- Funil de Vendas no dashboard continua em propostas — intencional (pré-venda)
- Perfis antigos podem ter só `proposals.material_report.view`; compatibilidade mantida

---

## 10. Checklist de validação manual

1. Cliente com pedidos e sem propostas — Commercial 360 e CRM mostram receita/ABC
2. Cliente com propostas e sem pedidos — 360 inativo comercialmente; propostas visíveis no módulo Propostas
3. Cliente com pedidos faturados — faturamento reconhecido via NFe
4. Cliente com pedidos em carteira — pipeline aberto por pedido
5. Vendedor com pedidos e sem propostas — seller dashboard OK
6. Vendedor com propostas e sem pedidos — seller dashboard sem receita proxy de proposta
7. Pedido cancelado — excluído de métricas
8. Pedido sem follow-up — alerta no CRM
9. Módulo Propostas CRUD/impressão — inalterado
10. Gerar pedido a partir de proposta aprovada — `generate-sales-order` funciona

---

## 11. Resultado da auditoria (Fase 8)

### Classificação de usos restantes de `Proposal`

| Categoria | Exemplos |
|-----------|----------|
| **1. Módulo Propostas legítimo** | CRUD, indicators tab, print |
| **2. Operacional proposta → pedido** | `generate-sales-order`, campos de vínculo |
| **3. Legado deprecated** | `computeCommercialPhase2`, `ProposalIntelSlice` |
| **4. Indevido corrigido** | Commercial 360, CRM dashboards, customer indicators, executive dashboard |

### Checklist de produção

| # | Item | Status |
|---|------|--------|
| 1 | Commercial 360 usa SalesOrder | OK |
| 2 | CRM Cockpit usa SalesOrder/openOrders | OK |
| 3 | CRM Management Dashboard usa SalesOrder | OK |
| 4 | CRM Seller Dashboard usa SalesOrder | OK |
| 5 | Customer Indicators usam SalesOrder | OK |
| 6 | Admin Seller Options usam SalesOrder | OK |
| 7 | Atividades comerciais aceitam salesOrderId | OK |
| 8 | Módulo Propostas continua funcionando | OK |
| 9 | Geração de pedido a partir de proposta | OK |
| 10 | Documentação principal alinhada | OK |

---

## 12. Arquivos-chave da migração

- `src/lib/crmCommercialOrderRules.ts` — regras canônicas
- `src/lib/customerCommercialShared.ts` — tipos/ABC compartilhados
- `src/lib/customerCommercialSalesOrderView.ts` — motor ativo
- `src/lib/customerCommercialProposalLegacy.ts` — legado isolado
- `src/lib/commercialMaterialDemandPermissions.ts` — permissões MP

---

*Documento gerado na Fase 8 da migração comercial Proposta → Pedido de Venda.*
