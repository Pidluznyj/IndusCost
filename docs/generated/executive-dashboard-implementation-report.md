# Relatório de Implementação — Dashboard Executivo IndusCost

**Data:** 2026-06-05  
**Commit:** `5265018`

---

## 1. Resumo

Nova **Visão Executiva** na tela inicial (`/dashboard`), alimentada por endpoint consolidado read-only com indicadores reais por módulo, respeitando permissões do usuário. Abas industrial e funil preservadas.

---

## 2. Indicadores disponíveis

| Bloco | Indicadores |
|-------|-------------|
| **Overview KPIs** | Pedidos mês (líq.), propostas abertas, clientes, veículos, alertas |
| **Comercial** | Pedidos mês, faturamento, ticket, abertos, enviados Nomus, propostas abertas/aprovadas/rejeitadas, pipeline |
| **Clientes** | Total, ativos, cadastro incompleto, novos 30d, consultas CNPJ 30d, follow-ups atrasados (CRM) |
| **Produtos** | Ativos, com BOM, com precificação, fabricados |
| **Nomus** | Bloqueados, aplicados, sem alteração, erros, última sync |
| **Frota** | Total, disponíveis, em uso, manutenção, manutenções abertas/atrasadas, reservas hoje, docs vencidos |
| **RH** | Colaboradores ativos |
| **Alertas** | Até 6 cards priorizados por severidade |
| **Links rápidos** | Conforme permissões |

---

## 3. Indicadores não implementados e motivo

| Indicador | Motivo |
|-----------|--------|
| Produtos sem custo / CIU inconsistente | Exige `getProductCostAnalysis` em massa — proibido na home |
| Top clientes por faturamento | Disponível em `/api/reports/data` (exige `reports.view`) — não duplicado |
| Tendência YoY completa | Apenas mês anterior para pedidos (seguro) |
| Documentos RH/CNH/EPI | Sem endpoint RH dedicado além de headcount |
| Margem média global comercial | Requer agregação reports — fora do escopo mínimo |
| KPI industrial na visão executiva | Mantido na aba Operação/Financeiro (`/api/dashboard`) |

---

## 4. Fontes de dados

| Seção | Fonte |
|-------|-------|
| Comercial | `prisma.salesOrder`, `prisma.proposal` |
| Clientes | `prisma.customer`, `CustomerCnpjLookup`, SQL `CommercialActivity` |
| Produtos | `prisma.product`, `ProductBOM`, `ProductPricing` |
| Nomus | `buildNomusAutoApplyBomDashboard({ revalidateBlocked: false })` |
| Frota | `buildFleetDashboardCards()` |
| RH | `prisma.employee` |

---

## 5. Endpoints

| Endpoint | Alteração |
|----------|-----------|
| `GET /api/dashboard/executive-summary` | **Novo** — consolidação executiva |
| `GET /api/dashboard` | **Inalterado** — aba industrial |

---

## 6. Arquivos criados/alterados

**Novos:** `executiveDashboardTypes.ts`, `executiveDashboardHelpers.ts`, `executiveDashboardService.ts`, `executiveDashboardRoutes.ts`, `executiveDashboardHelpers.test.ts`, `ExecutiveDashboardPanel.tsx`, docs diagnostic/report

**Alterados:** `DashboardModule.tsx`, `server.ts`, `package.json`

---

## 7. Permissões

- Endpoint exige `dashboard.view`
- Seções filtradas por: `sales_orders.view`, `proposals.view`, `customers.view`, `products.view`, fleet resolver, `employees.view`
- Sem novas permissões no catálogo

---

## 8. Validações

- `npx prisma validate`
- `npm run test:dashboard`
- `npm run lint`
- `npm run build`

---

## 9. Limitações conhecidas

- Nomus depende de relatório/sync existente; sem rotina, exibe mensagem vazia
- Comercial parcial se usuário só tem `customers.view`
- Aba industrial ainda pesada (legado)

---

## 10. Próximos passos

1. Reutilizar slice de `/api/reports/data` para quem tem `reports.view`
2. Endpoint server para funil de propostas
3. Indicadores RH (documentos vencendo) quando houver fonte
4. Cache TTL curto no executive-summary em produção

---

*Relatório gerado após implementação do dashboard executivo.*
