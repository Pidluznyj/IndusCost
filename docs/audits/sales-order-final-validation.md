# Validação final — Pedido de Venda / NF-e / motor único

**Projeto:** IndusCost / My Industry  
**Missão:** 6 — Validação ponta a ponta  
**Data:** 2026-06-23  
**Commit base:** `41358fe` (`feat(sales-orders): centralize order metrics across modules`)

---

## 1. Status dos pré-requisitos

| Pré-requisito | Status | Evidência |
|---------------|--------|-----------|
| Vínculo Pedido → NF-e | ✅ | `SalesOrderNfeLink`, migration `20260626120000_sales_order_nfe_link`, `salesOrderNfeLink.ts` |
| Motor logístico/gerencial com NF vinculada | ✅ | `salesOrderLinkedNfe` → `salesOrderLifecycleStatus` → `salesOrderLogisticStatus` → `salesOrderManagement` |
| Dashboard/funil atualizado | ✅ | `salesOrdersDashboardMetrics.ts`, `salesFunnelDashboardMetrics.ts`, funil operacional em `SalesFunnelPanel.tsx` |
| Gestão de Pedidos atualizada | ✅ | KPIs/filtros/gráficos via `salesOrderManagementFulfillment.ts` |
| Consumidores principais migrados | ✅ parcial | Dashboard, funil, CRM hasInvoicing, MP — ver §4 |
| Auditoria antes/depois | ✅ | `docs/audits/sales-order-consumers-audit.md`, `scripts/audit-sales-order-consumers-after-migration.ts` |
| Facade motor único | ✅ | `src/lib/salesOrderMetricsEngine.ts` v1.0.0 |

**Conclusão:** Todos os pré-requisitos existem. Financeiro SQL legado permanece como divergência conhecida (não bloqueia deploy com backfill + validação visual).

---

## 2. Arquitetura oficial (fonte única de verdade)

```
SalesOrderNfeLink (DB)
        ↓
buildSalesOrderLinkedNfeContext          ← salesOrderLinkedNfe.ts
        ↓
buildSalesOrderLifecycleSummary        ← salesOrderLifecycleStatus.ts
        ↓
buildSalesOrderBiLogisticStatus        ← salesOrderLogisticStatus.ts
        ↓
buildManagementRowsFromOrders            ← salesOrderManagement.ts
        ↓
salesOrderMetricsEngine (facade)         ← DTO + batch + agregações + funil operacional
        ↓
Consumidores: Dashboard, Funil, Gestão, MP (parcial), CRM hasInvoicing
```

**Regras de cálculo:**

| Métrica | Fonte | Regra |
|---------|-------|-------|
| Valor vendido | `SalesOrder.totalNetValue` | 1× por pedido; data = `issueDate` |
| Valor faturado | NF-es vinculadas (`SalesOrderNfeLink` + `NomusNfe`) | Soma `nfeTotalValue`; fallback raw dentro do motor |
| Status logístico | `buildSalesOrderBiLogisticStatus` | DataReal (NF) vs DataPlanejada (`expectedDeliveryDate`) |
| SLA | `salesOrderLinkedNfe` | Dias entre emissão/conclusão NF e prazo |
| Parcial / corte | Lifecycle + cobertura NF | % faturamento/atendimento |
| Revisar dados | Motor linked + itens | Dados insuficientes ou divergentes |

---

## 3. Parte A — Auditoria técnica de consistência

### Scripts

| Script | Comando | Escopo |
|--------|---------|--------|
| Validação final | `npm run audit:sales-order-final-validation` | NF links, status, valores, cross-module |
| Pós-migração | `npm run audit:sales-order-consumers-after-migration` | Consumidores legados |
| Fulfillment | `npm run audit:sales-order-fulfillment` | KPIs gestão (amostra) |
| Backfill NF | `npm run backfill:sales-order-nfe-links:dry` | Vínculos pendentes |

### 3.1 Integridade dos vínculos NF

Validado via `buildSalesOrderNfeLinkDiagnostic()`:

- Total de pedidos
- Pedidos com `nomusRawResponse.nfes`
- Total `SalesOrderNfeLink`
- Pedidos com raw NF sem link (`ordersWithNfesInPayloadButNoLinks`)
- Links sem match em `NomusNfe` (`linksWithoutNomusNfeMatch`)
- Pedidos com múltiplas NF-es
- Duplicidade `(salesOrderId, nfeExternalId)` — índice único impede duplicata real

**Ação deploy:** executar backfill `--dry-run` then `--apply` no servidor.

### 3.2 Integridade dos status

Via `loadSalesOrderEnrichedMetricsForIssueYear` + `aggregateSalesOrderMetrics`:

- Por status logístico (`byLogisticStatus`)
- Por status gerencial (`managementStatus`)
- No prazo / atrasado / pendente / parcial / corte / revisar — campos do aggregate

### 3.3 Consistência de valores

- `totalSoldValue`, `totalInvoicedValue`, `soldInvoicedGap`, `invoiceCoveragePercent`
- Pedidos NF > pedido (tolerância `INVOICE_COVERAGE_TOLERANCE_ABSOLUTE = 1`)
- NF com valor zero, sem `totalNetValue`, sem data planejada

### 3.4 Consistência entre módulos (Ano = configurável, default ano corrente)

Comparação automática em `audit-sales-order-final-validation.ts`:

| Métrica | Engine | Gestão Pedidos | Funil | Deve bater |
|---------|--------|----------------|-------|------------|
| Total pedidos válidos | ✅ | rows | — | Sim |
| Com NF | ✅ | hasInvoice | withNfe | Sim |
| Sem NF | ✅ | !hasInvoice | — | Sim |
| Pendente atrasado | ✅ | overduePending | pendingLate | Sim |
| Entregue no prazo | ✅ | deliveredOnTime | invoicedOnTime | Sim |
| Valor vendido | ✅ | fulfillmentKpis | — | Sim |
| Valor faturado NF | ✅ | fulfillmentKpis | — | Sim |

**Financeiro > Pedidos de Venda:** usa `loadSalesOrderLinkedNfeContextMap` + `buildSalesOrderBiLogisticStatus` em `financeSalesOrdersExtendedMetrics.ts` para breakdown logístico; **ainda usa** `orderIsInvoicedSql` em queries SQL de carteira — pode divergir até migração completa.

**Relatório Presidencial:** não consome funil operacional; KPIs de vendas via `salesOrdersDashboardMetrics` (migrado).

**CRM:** `salesOrderHasInvoicing` alinhado ao motor (extração NF + fallback); dashboards SQL do vendedor ainda legados.

---

## 4. Parte B — Auditoria de código

Classificação de achados (scan estático em `src/`):

### OK — dentro do motor único

| Arquivo | Uso |
|---------|-----|
| `salesOrderLinkedNfe.ts` | Contexto NF, SLA, cobertura |
| `salesOrderLogisticStatus.ts` | Status logístico BI + hints |
| `salesOrderLifecycleStatus.ts` | Status gerencial |
| `salesOrderMetricsEngine.ts` | Facade oficial |
| `salesOrderManagement.ts` / `Fulfillment` | Gestão + KPIs |
| `salesOrdersDashboardMetrics.ts` | Dashboard migrado |
| `salesFunnelDashboardMetrics.ts` | Funil migrado |

### OK — uso legítimo sync/payload

| Arquivo | Uso |
|---------|-----|
| `salesOrderNfeLink.ts` | Sync Nomus → links |
| `nomusSalesOrdersSyncV1.ts` | Persiste `nomusRawResponse` |
| `nomusNfesSync.ts` | Sync NF global |
| `backfill-sales-order-nfe-links.ts` | Backfill vínculos |
| `financeBillingNfeComparison.ts` | Metadados comparação fiscal |
| `materialDemandPlannedRealizedAudit.ts` | Documentação linhagem |

### Pendente — ainda calcula fora do motor (não bloqueia se backfill OK)

| Arquivo | Padrão | Risco |
|---------|--------|-------|
| `financeSalesOrdersDashboard.ts` | `orderIsInvoicedSql`, `orderNotInvoicedSql` | Contagens carteira/faturado SQL vs engine |
| `billingDashboardMetrics.ts` | `orderIsInvoicedSql` | KPI faturamento billing |
| `financeBillingForecast.ts` | `orderNotInvoicedSql` | Previsão |
| `financeBillingHorizonDrilldown.ts` | `orderNotInvoicedSql` | Drilldown |
| `crmSellerDashboardService.ts` | SQL inline duplicado | KPI vendedor |

### Risco — pode gerar número divergente

| Arquivo | Padrão | Mitigação |
|---------|--------|-----------|
| `financeSalesOrdersDashboard.ts` | SQL jsonb nfes | Migrar queries para `loadSalesOrderEnrichedMetrics*` |
| `crmSellerDashboardService.ts` | SQL inline | Idem |
| `salesProductRanking.ts` | Raw NF para data faturamento | Passar linked context |

**Nota:** Leituras de `nomusRawResponse.nfes` fora do motor são aceitáveis em **sync/backfill/auditoria**; inaceitáveis em **KPIs de negócio** após backfill.

---

## 5. Parte C — Testes automatizados

### Suites executadas na Missão 6

| Suite | Comando | Casos |
|-------|---------|-------|
| Validação final | `npm run test:sales-order-final-validation` | Pré-reqs, motor, labels, performance |
| Motor métricas | `npm run test:sales-orders-metrics-engine` | DTO, agregação, funil, MP |
| Fulfillment gestão | `npm run test:sales-orders-fulfillment` | NF, filtros, antiduplicidade |
| NF link | `npm run test:sales-orders-nfe-links` | Vínculo, idempotência |
| Logistic status | `src/lib/salesOrderLogisticStatus.test.ts` | 6 cards BI |
| Linked NFe motor | `src/lib/salesOrderLinkedNfeMotor.test.ts` | SLA, prazo, revisar |

### Cobertura por tema

| Tema | Coberto |
|------|---------|
| 1 NF / múltiplas NF / sem NF | ✅ |
| Idempotência link | ✅ `salesOrderNfeLink.test.ts` |
| Match NomusNfe | ✅ backfill preview |
| Status: prazo, atraso, pendente, parcial, corte, cancelado, revisar | ✅ logistic + fulfillment |
| Antiduplicidade 5 itens + 2 NF | ✅ |
| Dashboard/funil → engine | ✅ static |
| Gestão → management pipeline | ✅ |
| MP cancelados excluídos | ✅ |

---

## 6. Parte D — UX e labels

### Labels logísticos BI (usuário)

| Label | Onde | Tooltip/hint |
|-------|------|--------------|
| Entregue no Prazo | Cards BI, grid | NF processada ≤ data planejada |
| Entregue com Atraso | Cards BI, grid | NF processada > data planejada |
| No Prazo (Pendente) | Cards BI, grid | Sem NF; prazo ≥ hoje |
| Atrasado (Pendente) | Cards BI, grid | Sem NF; prazo < hoje |
| Finalizado/Cancelado | Cards BI | Sem NF; itens fora 1/2/3 |
| Revisar dados | Cards BI, filtro | Dados insuficientes |

### Labels operacionais (filtros)

| Label | Arquivo |
|-------|---------|
| Com NF / Sem NF | `salesOrderManagementUi.ts` |
| Com corte / Sem corte | `CUT_FILTER_OPTIONS` |
| Parcial | `FULFILLMENT_FILTER_OPTIONS` |
| Revisar dados | `PRAZO_FILTER_OPTIONS` |

### Microtextos funil operacional

Regras em `salesFunnelDashboardMetrics.ts` → `rules[]`:

- Data comercial = `issueDate`
- Valor vendido = `totalNetValue`
- Valor faturado = NF vinculada
- Status = motor Gestão de Pedidos

---

## 7. Parte E — Performance

| Área | Avaliação | Nota |
|------|-----------|------|
| `loadSalesOrderEnrichedMetricsForIssueYear` | Carrega todos pedidos do ano + links NF | OK para volumes atuais; monitorar >10k pedidos/ano |
| Gestão de Pedidos API | Paginação/filtros na rota | ✅ |
| Índices NF link | `salesOrderId`, `nfeExternalId`, `dataProcessamento` | ✅ migration |
| Múltiplas NF-es | Agregação por pedido no motor | Não explode linhas KPI |
| Dashboard funil | 1 batch engine/ano | Evita N+1 |

**Recomendação:** cache por ano em produção se tempo de resposta > 3s (futuro).

---

## 8. Parte F — Comandos finais

```bash
npx prisma validate                    # ✅ schema válido
npm run test:sales-order-final-validation
npm run test:sales-orders-metrics-engine
npm run test:sales-orders-fulfillment
npm run test:sales-orders-nfe-links
npm run build                          # ✅ vite build
```

### Migration

- Migration versionada: `20260626120000_sales_order_nfe_link`
- **Não** executar `migrate deploy` em produção nesta missão localmente
- **Servidor:** `npx prisma migrate deploy`

---

## 9. Divergências remanescentes

| Divergência | Impacto | Plano |
|-------------|---------|-------|
| Finance SQL `orderIsInvoicedSql` | Carteira financeira vs engine | Migrar para batch engine |
| CRM seller SQL | KPI vendedor | Idem |
| Ranking produtos raw NF | Data NF ranking | Passar linked context |
| Runtime DB local ausente | Auditoria JSON incompleta | Executar script no servidor |

Nenhuma divergência impede deploy se backfill NF for aplicado e validação visual passar.

---

## 10. Validação visual esperada (pós-deploy)

- [ ] Dashboard/funil: bloco **Funil Operacional de Vendas** + KPIs vendido/faturado/gap
- [ ] Gestão de Pedidos: colunas NF, data NF, status logístico, SLA, revisar dados
- [ ] Filtros Com NF / Sem NF retornam mesma contagem que cards BI
- [ ] Pedido com 2+ NF-es: 1 linha no grid, valor faturado = soma NF
- [ ] Atrasados coerentes com prazo vencido sem NF completa
- [ ] SLA médio coerente no painel fulfillment
- [ ] Revisar dados mostra `reviewReasons` no drawer

---

## 11. Referências

- Auditoria consumidores (Missão 4): `docs/audits/sales-order-consumers-audit.md`
- Relatório JSON runtime: `docs/audits/sales-order-final-validation-report.json` (gerado pelo script)
- Commit motor único: `41358fe`
