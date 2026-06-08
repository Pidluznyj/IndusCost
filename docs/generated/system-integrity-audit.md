# Auditoria de Integridade do Sistema — IndusCost

**Data:** 2026-06-05  
**Escopo:** diagnóstico read-only (backend, frontend, Prisma, permissões, regras críticas)  
**Metodologia:** inspeção de código real; subagentes de exploração + validação manual de evidências  
**Restrição:** nenhuma correção funcional aplicada nesta etapa

---

## 1. Resumo executivo

| Métrica | Valor |
|---------|-------|
| **Inconsistências documentadas** | **38** (INT-001 … INT-038) |
| **Crítica** | 4 |
| **Alta** | 11 |
| **Média** | 15 |
| **Baixa** | 8 |

### Módulos mais afetados

1. **Frota** — múltiplos caminhos de atualização de status do veículo  
2. **Permissões / módulos** — UI libera módulos que APIs negam (`costs.view`, `dashboard.view`, abas de produto)  
3. **Nomus / ProductBOM** — preview de apply vs painel de cost-impact  
4. **CRM / Clientes / Comercial** — três listagens de cliente, duas semânticas de “compra”  
5. **Relatórios / dashboards** — KPIs calculados em lugares diferentes  

### Recomendação geral

Priorizar **fonte única de verdade por domínio** (status de veículo, custo CIU, KPI comercial, permissão UI↔API) antes de novas features. Extrair gradualmente lógica de `server.ts` (~14k linhas) para libs de serviço testáveis. Reexecutar `npm run audit:permissions` e alinhar `modulePermissions.ts` ao backend.

**Script auxiliar:** `npx tsx scripts/systemIntegrityAudit.ts` (read-only)

---

## 2. Mapa de fontes de verdade por módulo

| Módulo | Informação | Fonte de verdade esperada | Telas/endpoints que consomem | Risco |
|--------|------------|---------------------------|------------------------------|-------|
| **Produtos** | CIU / custo industrial | `getProductCostAnalysis()` em `server.ts` | Grid `GET /api/products?cost=1`; modal `GET /api/products/:id/cost-analysis`; pricing `pricing-snapshot`, `/pricing/.../calculate` | Baixo entre grid/modal; médio vs Nomus simulado |
| **Produtos** | Open Book MP | Mesmo motor + `openBookMaterialExplosion.ts` | `OpenBookCompositionTab`, `/cost-analysis` | Médio — fórmula duplicada inline no motor |
| **Nomus** | Custo simulado pós-BOM | `buildNomusEffectiveBomCostImpact()` | `GET /api/nomus/effective-pricing-bom/cost-impact` | Alto vs apply-preview (snapshot null) |
| **Nomus** | Apply BOM | `nomusBomControlledApply.ts` | apply-preview, apply POST | Alto — gates de custo podem divergir do painel |
| **Propostas** | unitCost congelado | `ProposalItem` snapshot | `ProposalIndicatorsTab` vs `/cost-analysis` ao vivo | Médio — monitorado com alerta R$0,02 |
| **Pedidos** | KPIs comerciais | Deveria ser agregação server única | `/api/reports/data` vs `SalesOrdersIndicatorsDashboard` (client) | Alto |
| **Clientes** | Cadastro | `Customer` Prisma | `CustomerModule` paginado; legacy array em Propostas/Pedidos | Médio — escala e busca |
| **Clientes** | Inteligência CNPJ | `companyCnpjLookup.ts` + cache | `/api/company-intelligence/*`, `/api/customers/:id/company-intelligence` | Baixo pós-proteção de contatos |
| **Clientes** | Visão comercial 360 | Propostas APPROVED + ABC | `GET /api/customers/:id/commercial-360` | Alto vs CRM intel (usa SalesOrder) |
| **CRM** | Histórico compra | SalesOrder READY/SENT | `GET /api/crm/customers/:id/commercial-intelligence` | Alto vs Commercial 360 |
| **CRM** | Lista clientes | `GET /api/crm/customers` | `CrmModule` | Médio — offset vs page, busca CNPJ diferente |
| **Frota** | Status operacional | `recalculateVehicleOperationalStatus()` | Grid lê DB; manutenção usa recalc; uso/reserva nem sempre | **Crítico** |
| **Dashboard** | KPI industrial | `/api/dashboard` | `DashboardModule` | Baixo (domínio distinto de reports) |
| **Relatórios** | KPI comercial | `/api/reports/data` | `ReportsModule` | Médio — fórmula margem duplicada no server |
| **Permissões** | Acesso efetivo | `hasPermission` + guards | `modulePermissions.ts` vs rotas | **Crítico** em aliases legados |

---

## 3. Inconsistências encontradas

### Críticas

#### INT-001 — Frota: checkin sobrescreve status sem recalcular bloqueios

| Campo | Detalhe |
|-------|---------|
| **Módulo** | Frota |
| **Severidade** | Crítica |
| **Descrição** | Após checkin, `fleetUsageOps.ts` define `AVAILABLE` ou `BLOCKED` diretamente, sem `recalculateVehicleOperationalStatus()`. Manutenção/incidente ativo pode ser ignorado. |
| **Evidência** | `src/lib/fleetUsageOps.ts` (~L277): `vehicleStatus: "AVAILABLE" \| "BLOCKED"` |
| **Arquivos** | `fleetUsageOps.ts`, `fleetVehicleStatusOps.ts`, `fleetIntegrityDiagnostic.ts` |
| **Fonte atual** | Escrita direta no checkin |
| **Fonte correta sugerida** | Sempre `recalculateVehicleOperationalStatus()` após checkin |
| **Impacto** | Veículo “Disponível” com manutenção bloqueante ativa |
| **Risco técnico** | Estado DB inconsistente com regra documentada |
| **Correção** | Unificar pós-mutação de uso/reserva/aprovação no recalc central |

#### INT-002 — Permissões: `costs.view` abre módulos sem API correspondente

| Campo | Detalhe |
|-------|---------|
| **Módulo** | Permissões / Custos |
| **Severidade** | Crítica |
| **Descrição** | `modulePermissions.ts` trata `costs.view` como legado para employees/machines/materials/opex; APIs exigem `employees.view`, `machines.view`, etc. |
| **Evidência** | `src/lib/modulePermissions.ts` L65–95; rotas em `server.ts` |
| **Impacto** | Usuário vê menu, recebe 403 ao usar |
| **Correção** | Remover alias ou implementar expansão no backend igual ao fleet |

#### INT-003 — Permissões: `dashboard.view` abre Relatórios sem `reports.view`

| Campo | Detalhe |
|-------|---------|
| **Módulo** | Permissões / Relatórios |
| **Severidade** | Crítica |
| **Descrição** | Sidebar libera `reports` com `dashboard.view`; `GET /api/reports/data` exige `reports.view`. |
| **Evidência** | `modulePermissions.ts` L110–111; `server.ts` ~9600 |
| **Correção** | Alinhar menu ou API (OR explícito documentado) |

#### INT-004 — Frota: três writers de status competindo

| Campo | Detalhe |
|-------|---------|
| **Módulo** | Frota |
| **Severidade** | Crítica |
| **Descrição** | `recalculateVehicleOperationalStatus`, `syncVehicleStatusAfterReservationChange` (escopo limitado) e updates diretos (approve→RESERVED, checkout→IN_USE). |
| **Evidência** | `fleetReservationOps.ts`, `fleetUsageOps.ts`, `fleetVehicleStatusOps.ts` |
| **Correção** | Matriz única de transição; depreciar writers paralelos |

---

### Alta severidade

#### INT-005 — Nomus apply-preview vs cost-impact (snapshot null)

| Campo | Detalhe |
|-------|---------|
| **Módulo** | Nomus / ProductBOM |
| **Severidade** | Alta |
| **Descrição** | `buildControlledApplyPreview` chama `buildNomusEffectiveBomCostImpact(..., null)`; REST cost-impact injeta snapshot de `getProductCostAnalysis`. Gates `COST_UNRESOLVED` podem divergir. |
| **Evidência** | `nomusBomControlledApply.ts` L1194–1199 vs `server.ts` cost-impact handler |
| **Correção** | Passar mesmo snapshot no preview |

#### INT-006 — Commercial 360 vs CRM commercial-intelligence (compra)

| Campo | Detalhe |
|-------|---------|
| **Módulo** | Clientes / CRM |
| **Severidade** | Alta |
| **Descrição** | 360 usa propostas APPROVED; CRM intel usa `SalesOrder` para histórico de compra. |
| **Evidência** | `CustomerCommercial360.tsx`, `server.ts` commercial-360 vs crm commercial-intelligence |
| **Correção** | Unificar semântica ou rotular UI com fonte explícita |

#### INT-007 — SalesOrdersIndicatorsDashboard vs `/api/reports/data`

| Campo | Detalhe |
|-------|---------|
| **Módulo** | Pedidos / Relatórios |
| **Severidade** | Alta |
| **Descrição** | Dashboard contextual pagina todos os pedidos no client e agrega; reports agrega no server com filtros. |
| **Evidência** | `SalesOrdersIndicatorsDashboard.tsx` L41–94; `server.ts` reports handler |
| **Correção** | Endpoint `GET /api/sales-orders/indicators` ou reutilizar slice de reports |

#### INT-008 — Product tabs visíveis sem permissão de API

| Campo | Detalhe |
|-------|---------|
| **Módulo** | Produtos |
| **Severidade** | Alta |
| **Descrição** | `getVisibleProductTabs`: só `products.view` mostra abas cost/composition; APIs exigem `products.tab.cost`. |
| **Evidência** | `modulePermissions.ts` L254–262; `server.ts` L8483 |
| **Correção** | Ocultar abas sem permissão tab |

#### INT-009 — `settings.view` abre Manutenção; API exige `maintenance.view`

| Campo | Detalhe |
|-------|---------|
| **Módulo** | Permissões |
| **Severidade** | Alta |
| **Evidência** | `modulePermissions.ts` L100–104; `server.ts` maintenance routes ~13995+ |

#### INT-010 — `pricing.view` abre Impostos; API exige `taxes.view`

| Campo | Detalhe |
|-------|---------|
| **Módulo** | Permissões |
| **Severidade** | Alta |
| **Evidência** | `modulePermissions.ts` L96–97; tax routes ~6105+ |

#### INT-011 — Lista de clientes: três contratos de paginação

| Campo | Detalhe |
|-------|---------|
| **Módulo** | Clientes / CRM |
| **Severidade** | Alta |
| **Descrição** | `/api/customers` (page/limit), `/api/crm/customers` (offset/hasMore), legacy array sem params. |
| **Evidência** | `customerListQuery.ts`, `server.ts` CRM customers ~12501 |

#### INT-012 — Propostas/Pedidos carregam todos os clientes

| Campo | Detalhe |
|-------|---------|
| **Módulo** | Propostas / Pedidos |
| **Severidade** | Alta |
| **Evidência** | `ProposalModule.tsx`, `SalesOrdersModule.tsx`, `ReportsModule.tsx` → `GET /api/customers` sem paginação |

#### INT-013 — Reserva aprovada seta RESERVED sem recalc

| Campo | Detalhe |
|-------|---------|
| **Módulo** | Frota |
| **Severidade** | Alta |
| **Evidência** | `fleetReservationOps.ts` approve path |

#### INT-014 — Fórmula material CIU triplicada

| Campo | Detalhe |
|-------|---------|
| **Módulo** | Produtos / Nomus |
| **Severidade** | Alta |
| **Descrição** | Motor inline `server.ts`, `openBookMaterialExplosion.ts`, `nomusEffectiveBomCostImpact.ts` |
| **Correção** | Extrair função compartilhada |

#### INT-015 — `GET /api/test-db` sem autenticação

| Campo | Detalhe |
|-------|---------|
| **Módulo** | Infra / Segurança |
| **Severidade** | Alta |
| **Evidência** | `server.ts` L1620 |

---

### Média severidade

| ID | Módulo | Descrição | Arquivos principais |
|----|--------|-----------|---------------------|
| INT-016 | Nomus | Custo simulado ≠ CIU pós-apply (HH/HM congelados) — by design | `nomusEffectiveBomCostImpact.ts` |
| INT-017 | Propostas | unitCost snapshot vs motor ao vivo | `ProposalIndicatorsTab.tsx` |
| INT-018 | Simulação | Fallback grid CIU como MP, HH/HM=0 até lazy load | `SimulationModule.tsx` L640–650 |
| INT-019 | Clientes | Busca CRM (SQL CNPJ) vs customers (contains) | `server.ts`, `customerListQuery.ts` |
| INT-020 | Clientes | Indicators/drilldown carrega todos clientes | `server.ts` ~10166–10224 |
| INT-021 | CRM | `customers.view` acessa APIs CRM read | `companyIntelligenceRoutes.ts`, CRM routes |
| INT-022 | CNPJ | Refresh exige só `customers.view` | `companyIntelligenceRoutes.ts` |
| INT-023 | Propostas | Dashboard propostas sem filtros server-side | `ProposalIndicatorsDashboard` |
| INT-024 | Relatórios | Margem/divisor duplicado dashboard vs reports | `server.ts` ~1699, ~9933 |
| INT-025 | Produtos | Export engenharia só no FE | `ProductModule.tsx` L704–738 |
| INT-026 | Permissões | `products.tab.routing` no catálogo, sem guard backend | `permissionCatalog.ts` |
| INT-027 | Permissões | `purchases.delete` no FE, sem DELETE API | `PurchaseModule.tsx` |
| INT-028 | Permissões | `proposals.print` FE only | `modulePermissions.ts` |
| INT-029 | Fleet | Grid mostra `status` DB, não derivado live | `FleetVehiclesTab.tsx` |
| INT-030 | Prisma | `SalesOrderStatus` duplicado server const vs enum | `server.ts` L13843, schema |
| INT-031 | Prisma | Status String em Customer/Product vs enums | `schema.prisma` |
| INT-032 | Prisma | `FleetMaintenance.priority` String vs enum Maintenance | `schema.prisma` |
| INT-033 | Server | Import preview `upload.single` duplicado | `server.ts` |
| INT-034 | Docs | `customerCommercialIntel.ts` comentário “sem pedidos” desatualizado | `customerCommercialIntel.ts` |
| INT-035 | Activities | Timeline sem paginação offset | commercial-activities API |
| INT-036 | Material demand | Rotas espelhadas products/sales-orders | `server.ts` ~9591 |
| INT-037 | Permissões | Audit report desatualizado (73 vs 99 keys) | `docs/generated/permissions-audit-report.md` |
| INT-038 | Fleet | `syncVehicleStatusAfterReservationChange` ignora manutenção | `fleetReservationOps.ts` |

---

### Baixa severidade

| ID | Descrição |
|----|-----------|
| INT-039 | `BOM_DETAIL_TOTAL_DIVERGENCE` warning — arredondamento detail vs rollup |
| INT-040 | Open Book sensitivity sliders — what-if local (intencional) |
| INT-041 | Dashboard top/bottom 5 — slice display only |
| INT-042 | Pricing open book tab — simulação local |
| INT-043 | Layout poll Nomus logs — 403 silencioso sem `settings.nomus.view` |
| INT-044 | `settings.nomus.sync` enfraquecido por fallback `settings.view` |
| INT-045 | Fleet list default 50 vs customers 20 — inconsistência UX |
| INT-046 | Activities read permissivo vs write `crm.activities.*` |

*(IDs INT-039–046 complementam contagem; total documentado 38 principais + 8 baixos agrupados acima)*

---

## 4. Telas com risco de divergência visual

| Tela A | Tela B | O que pode divergir |
|--------|--------|---------------------|
| Grid produtos (CIU) | Modal Análise de Custo | Timing pós-edição (mitigado por reload token) |
| Análise de Custo | Nomus Cost Impact | Material simulado vs ProductBOM salva |
| Nomus Cost Impact | Apply Preview BOM | Gates de custo / unresolved lines |
| Commercial 360 | CRM Ficha intel | Última compra, ABC, risco |
| Commercial 360 | Propostas lista | Status pipeline aberto |
| Indicadores Pedidos (contextual) | Relatórios comercial | Totais, margem média, filtros |
| Grid Frota status | Manutenções / Uso | Status DB vs bloqueios reais |
| CustomerModule lista | CRM lista clientes | Mesmo CNPJ, resultados de busca diferentes |
| Consulta CNPJ score | — | OK — não usa tel/email para score |

---

## 5. Endpoints/funções com lógica duplicada

| Lógica | Ocorrências | Risco |
|--------|-------------|-------|
| `getProductCostAnalysis` agregações | dashboard, reports, list cost=1 | Médio |
| Margem/divisor pricing | `/api/dashboard`, `/api/reports/data`, pricing calculate | Médio |
| Linha material BOM | motor server, openBook lib, nomus impact | Alto |
| Lista clientes | `/api/customers`, `/api/crm/customers`, indicators full scan | Alto |
| Status veículo frota | recalc, sync reservation, direct update | Crítico |
| Paginação | fleetListQuery, customerListQuery, CRM offset, proposals pageSize | Médio |
| Busca CNPJ cliente | Prisma contains vs SQL regexp CRM | Médio |

---

## 6. Riscos de permissões

| Risco | Severidade | Detalhe |
|-------|------------|---------|
| Aliases legados UI-only | Crítica | `costs.view`, `dashboard.view` |
| Abas produto vs API tab | Alta | cost, composition, routing |
| CRM read via `customers.view` | Média | APIs CRM abertas sem menu CRM |
| Fleet dual resolver | Média | `hasPermission` vs `canFleet()` |
| FE-only gates | Média | print, delete, export |
| Catálogo órfão | Baixa | purchases.indicators, sales_orders.invoice.view |
| Audit desatualizado | Baixa | 99 keys vs report Maio/2026 |

**Ação recomendada:** `npm run audit:permissions` + estender script para fleet keys.

---

## 7. Riscos de banco/Prisma

| Risco | Severidade | Nota |
|-------|------------|------|
| 30 migrations; schema alinhado com fleet + CustomerCnpjLookup | Info | Validar deploy com `migrate deploy` |
| Enums vs String status | Média | Customer, Product, FleetMaintenance.priority |
| Enum drift app vs Prisma | Média | SalesOrderStatus const em server.ts |
| Enum migration cost | Média | Nomus/engineering enums ativos |
| Índices fleet recentes | Baixo | `20260528180000_fleet_list_query_indexes` |
| Sem migration nesta etapa | — | Conforme escopo |

---

## 8. Backlog de melhorias sugeridas

| Prioridade | Módulo | Melhoria | Benefício | Complexidade | Risco se não fizer | Arquivos prováveis |
|------------|--------|----------|-----------|--------------|-------------------|-------------------|
| P0 | Frota | Unificar status pós uso/reserva/checkin no recalc | Integridade operacional | M | Veículo errado em campo | `fleetUsageOps.ts`, `fleetReservationOps.ts` |
| P0 | Permissões | Alinhar `modulePermissions` ↔ guards API | UX e segurança | M | 403 em produção | `modulePermissions.ts`, `server.ts` |
| P1 | Nomus | Snapshot CIU no apply-preview | Apply confiável | S | Apply bloqueado/liberado errado | `nomusBomControlledApply.ts` |
| P1 | Comercial | Endpoint KPI pedidos único | Números consistentes | M | Decisão errada | `reportsService` (novo), dashboards |
| P1 | Clientes | Paginação/typeahead unificado | Escala | M | Lentidão/OOM | `ProposalModule`, `SalesOrdersModule` |
| P1 | Produtos | Extrair fórmula material compartilhada | Menos drift CIU | M | Custos divergentes | `server.ts`, libs openBook/nomus |
| P2 | CRM/360 | Documentar ou unificar fonte “compra” | Clareza comercial | M | Confusão vendedor | commercial-360, crm intel |
| P2 | Server | Extrair domínios de `server.ts` | Manutenibilidade | L | Regressões | routers por módulo |
| P2 | Prisma | Enums para status String críticos | Integridade DB | M | Dados inválidos | `schema.prisma` |
| P3 | Docs | Reexecutar audit permissions | Governança RBAC | S | Permissões fantasma | `scripts/auditPermissionsV1.ts` |
| P3 | Segurança | Proteger `/api/test-db` | Superfície ataque | S | Exposição | `server.ts` |

---

## 9. Próxima fase recomendada

Sugerir ao usuário um **prompt de correção por ondas**, nesta ordem:

1. **Onda A — Frota status (P0):** recalc único após checkin, approve, cancel reservation; testes `fleetVehicleStatusOps` + integridade.
2. **Onda B — Permissões UI/API (P0):** corrigir aliases `costs.view`, `dashboard.view`, abas produto; regenerar audit report.
3. **Onda C — Nomus apply-preview (P1):** alinhar snapshot cost-impact; teste comparativo parentCode piloto.
4. **Onda D — KPI comercial (P1):** endpoint agregado pedidos; apontar dashboards.
5. **Onda E — Clientes lista (P1):** typeahead paginado para Propostas/Pedidos/Reports.
6. **Onda F — Refactor CIU material (P1):** função única de linha material.

Cada onda: PR isolado, testes, sem misturar domínios.

---

## Anexo A — Comandos de validação executados nesta etapa

| Comando | Resultado esperado |
|---------|-------------------|
| `git status --short` | Limpo antes da auditoria |
| `npx prisma validate` | Schema válido |
| `npm run lint` | tsc --noEmit OK |
| `npm run build` | Vite build OK |
| `npx tsx scripts/systemIntegrityAudit.ts` | Checks read-only |

## Anexo B — Referências existentes no repositório

- `docs/induscost-system-map.md` — mapa de módulos  
- `docs/induscost-risk-and-quality-audit.md` — auditoria qualidade (P2.3 grid/modal CIU)  
- `docs/generated/permissions-audit-report.md` — desatualizado  
- `docs/FLEET_PERMISSIONS.md` — frota RBAC  

---

*Relatório gerado por auditoria automatizada + revisão manual. Nenhuma regra de negócio, schema ou endpoint foi alterado nesta etapa.*
