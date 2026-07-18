# OP-80 — Release Candidate: Kanban Comercial de Pedidos

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | OP-80 |
| **Cadeia** | OP-45 … OP-79 |
| **Atualizado** | 2026-07-17 |
| **Status** | Release Candidate de código — go-live operacional depende do servidor |
| **Feature flag** | `COMMERCIAL_SALES_ORDER_FLOW_ENABLED` (fail closed) |
| **Computation** | `sales-order-flow/v1` |

> O Cursor **não** tem acesso ao banco de produção. Medições de latência reais, migrate/deploy e ativação da flag ocorrem no servidor conforme `deployment-runbook.md`.

---

## 0. Checklist YAGNI / reutilização (antes de alterar)

| Pergunta | Decisão RC |
|----------|-----------|
| Nova tabela mestre de status do pedido? | **Não** — snapshots derivados |
| Drag-and-drop / edição manual de coluna? | **Não** — coluna = motor |
| Reescrever FIN-03 / O2C / Nomus? | **Não** — evidência read-only |
| Framework genérico de feature flags? | **Não** — env server-side |
| Denormalizar sort keys / GIN? | **Não** sem EXPLAIN em produção (OP-75) |
| Normalizar qty produzida / ship date agora? | **Não** — proxy + códigos `PRODUCTION_QTY_NOT_NORMALIZED` / `NFE_SHIP_DATE_MISSING` |
| Recompute no GET do Kanban? | **Não** — lê snapshots |

**Correção incluída neste RC:** adapter OP-49→OP-50 passa a respeitar `stockDocument.isCancelled` (além de `statusRaw` contendo `cancel`), para regressão correta após cancelamento de Documento de Saída.

---

## 1. Arquitetura

```text
Fontes oficiais (read-only)
  SalesOrder / SalesOrderItem
  NomusProductionOrder* / NomusStockDocument* / NomusNfe* / O2C alloc
        │
        ▼
  Evidence pack (OP-49) ──► Item engine (OP-50) ──► Order engine (OP-51)
        │                         │                        │
        │                         └──────────┬─────────────┘
        │                                    ▼
        │                         Fingerprint + draft (OP-54)
        │                                    │
        │                    ┌───────────────┼───────────────┐
        │                    ▼               ▼               ▼
        │              Snapshots         Events         Management
        │           (item+pedido)     (timeline)       (overlay)
        │
        ├── Rebuild CLI (OP-56)
        ├── Recompute pós-sync Nomus (OP-57)
        ├── Auditor read-only (OP-78)
        └── HTTP Kanban (OP-58…OP-73) ← feature flag + permissões + escopo
```

| Camada | Módulos principais |
|--------|-------------------|
| Evidência | `salesOrderFlowEvidence.ts` / `.server.ts` |
| Liberação | `salesOrderReleaseStatusMapper.ts` |
| Necessidade de produção | `salesOrderItemProductionRequirement.ts` |
| Motor item | `salesOrderItemFlowEngine.ts` |
| Consolidação | `salesOrderFlowEngine.ts` + `pickSalesOrderFlowStageFromItemStages` |
| Catálogo | `salesOrderFlowCatalog.ts` |
| Persistência | `salesOrderFlowRepository.server.ts` |
| Recompute / rebuild | `salesOrderFlowRecompute*.ts`, `salesOrderFlowRebuild*.ts` |
| Pós-sync | `salesOrderFlowRecomputeAfterNomusSync*.ts` |
| Flag | `salesOrderFlowFeatureFlags.ts` |
| APIs | `salesOrderFlowList/Summary/Detail*.ts`, `salesOrderFlowRoutes.ts` |
| UI | `SalesOrderFlowModule/KanbanBoard/DetailDrawer/ManagementPanel.tsx` |
| Observabilidade | `salesOrderFlowObservability*.ts` |
| Auditor | `salesOrderFlowProductionAudit*.ts` |
| Performance | `salesOrderFlowPerformance.ts` |

**Tabelas derivadas (reconstruíveis):** `SalesOrderItemFlowSnapshot`, `SalesOrderFlowSnapshot`, `SalesOrderFlowEvent`, `SalesOrderFlowManagement`.

**Fontes oficiais nunca escritas pelo Fluxo:** `SalesOrder`, `SalesOrderItem`, OP Nomus, Documentos, NF-e, CR, caixa.

---

## 2. Regras confirmadas

| Regra | Status | Evidência |
|-------|--------|-----------|
| Nenhuma coluna alterável manualmente | OK | `FORBIDDEN_BODY_KEYS` inclui `currentStage` — `salesOrderFlowManagement.ts`; sem drag API |
| OP / Documento / NF sem contagem dupla | OK | `sumDedupedQty` / `sumNfeQty` / allocationKey — `salesOrderItemFlowEngine.ts` |
| Corte encerra saldo operacional | OK | `FULFILLED_WITH_CUT` → `shipTarget` = fulfilled; matriz #18/#27 |
| Parcial mantém saldo ativo | OK | `activeRemainingQuantity` / matriz #17/#28 |
| NF válida define envio (proxy) | OK | `shippedQuantity` = qty NF válida; #12/#15 |
| NF cancelada faz o fluxo retornar | OK | NF cancelada excluída; estágio `WAITING_NFE`; #13/#30 |
| Documento cancelado faz o fluxo retornar | OK | `isCancelled` **ou** `statusRaw~cancel`; #11/#29 + teste evidence |
| Item UNKNOWN não é concluído | OK | força fora de `SHIPPED_COMPLETED`; #20 |
| Coluna = primeira pendência | OK | `pickSalesOrderFlowStageFromItemStages` (min priority ativos) |
| Snapshots reconstruíveis | OK | rebuild/recompute; migrations aditivas |
| Fontes oficiais não alteradas | OK | repos só upsert tabelas de fluxo |

### Máquina de estados (colunas)

1. `WAITING_RELEASE`  
2. `WAITING_PRODUCTION_ORDER`  
3. `IN_PRODUCTION`  
4. `WAITING_OUTPUT_DOCUMENT`  
5. `WAITING_NFE`  
6. `SHIPPED_COMPLETED`  
7. `CANCELED`  

Auxiliar (não coluna): `INCONSISTENT`.

Normativo: `state-machine.md`.

---

## 3. Migrations

| Migration | Conteúdo |
|-----------|----------|
| `20260801120000_sales_order_flow_lifecycle_snapshots` | Snapshots item/pedido, eventos, management (aditiva) |
| `20260802120000_sales_order_flow_event_observed_at` | `SalesOrderFlowEvent.observedAt` |

`npx prisma format` / `npx prisma validate` — OK neste RC.

---

## 4. Endpoints

| Método | Path | Notas |
|--------|------|-------|
| GET | `/api/commercial/sales-order-flow/feature-status` | Auth; reporta flag |
| GET | `/api/commercial/sales-order-flow/summary` | Flag + flow view |
| GET | `/api/commercial/sales-order-flow` | Listagem/colunas paginadas |
| GET | `/api/commercial/sales-order-flow/lookup/responsible-users` | Management + responsibility |
| GET | `/api/commercial/sales-order-flow/:salesOrderId` | Detalhe |
| GET | `/api/commercial/sales-order-flow/:salesOrderId/events` | Timeline |
| PATCH | `/api/commercial/sales-order-flow/:salesOrderId/management` | Overlay (não stage) |
| POST | `/api/commercial/sales-order-flow/:salesOrderId/recompute` | Rebuild unitário |
| GET | `/api/settings/system/sales-order-flow/status` | Settings (mesmo com flag OFF) |

UI: `/commercial/sales-order-flow`.

---

## 5. Permissões

| Capacidade | Resource | Action |
|------------|----------|--------|
| Kanban | `commercial.sales_orders.flow` | view |
| Valores | `commercial.sales_orders.flow.values` | view |
| Financeiro | `commercial.sales_orders.flow.financial` | view |
| Inconsistências | `commercial.sales_orders.flow.inconsistencies` | view |
| Timeline | `commercial.sales_orders.flow.timeline` | view |
| Management | `commercial.sales_orders.flow_management` | manage |
| Prioridade / responsável / bloqueio | `…flow_management.{priority,responsibility,blocking}` | manage |
| Rebuild HTTP | `commercial.sales_orders.flow_rebuild` | execute |
| Produção (drawer) | `operations.production_orders` | view |
| Fiscal (drawer) | `commercial.sales_orders.invoice` | view |

Escopo: `resolveSalesOrderFlowAccessScope` — portfólio próprio vs unrestricted (SUPER_ADMIN / gestores).

---

## 6. Feature flag

- Env: `COMMERCIAL_SALES_ORDER_FLOW_ENABLED`
- Valores ON: `1` / `true` / `yes` / `on` / `enabled`
- Default: **OFF** (ausente/inválido)
- OFF → rotas Kanban **404**; menu oculto
- Rebuild, migrate e recompute pós-sync **não** dependem da flag UI

---

## 7. Scripts

| npm | Uso |
|-----|-----|
| `rebuild:sales-order-flow` / `:preview` / `:apply` | Backfill / piloto |
| `audit:sales-order:flow` | Auditor read-only por pedido |
| `test:sales-order:flow-audit` | Testes do auditor |

Runbooks: `rebuild-runbook.md`, `production-audit-runbook.md`, `deployment-runbook.md`.

---

## 8. Testes

Suítes direcionadas do RC (amostra):

- Matriz lifecycle OP-76 (`salesOrderFlowLifecycleMatrix.test.ts`) — 35 cenários
- API + UI validation OP-77 (inclui viewports **1366×768** e **1920×1080**)
- Item engine OP-50 (inclui `isCancelled` evidence)
- Feature flag, permissões, management, rebuild, recompute, performance, production audit

Gates executados neste RC:

- [x] `npx prisma format`
- [x] `npx prisma validate`
- [x] testes direcionados do fluxo
- [x] `npm test`
- [x] `npm run build`
- [x] `git diff --check`

---

## 9. Revisão de segurança (RC)

Escopo revisado: rotas, flag, management PATCH, escopo comercial, rebuild/audit scripts.

| Tema | Resultado |
|------|-----------|
| Feature flag fail-closed | OK — 404 sem expor superfície |
| AuthZ / matrix de recursos | OK — guards por endpoint + capabilities |
| Escopo portfólio | OK — seller limitado; SA unrestricted |
| PATCH stage | OK — rejeitado (`currentStage` forbidden) |
| Write surface | OK — só tabelas derivadas + management overlay |
| Auditor | OK — read-only; sem Nomus; senha sanitizada |
| Secrets em logs | OK — `DATABASE_URL` display sem senha nos audits |

**Correção de correção:** cancelamento de Documento via flag booleana oficial (evita falso positivo de cobertura).

Pendências operacionais (não bugs de código): medir latência no servidor; ativar flag só após piloto (`deployment-runbook.md`).

---

## 10. Revisão de desempenho

Referência: `performance-review.md` / `salesOrderFlowPerformance.ts`.

| Superfície | Orçamento query | Meta latência (ref.) |
|------------|-----------------|----------------------|
| Summary | 8 | ≤ 1 s |
| List/stage | ≤ 3 / stage | carga inicial ≤ 2 s; page ≤ 1 s |
| Evidence batch | ≤ 9 steps | — |
| Detalhe | 1 scope + evidence (+flags) + repo | ≤ 2 s |

Kanban lê **snapshots**, não recompute live. Rebuild/post-sync usam evidência em lote (OP-75).

**Limitação:** metas não foram medidas em produção neste ciclo.

---

## 11. Revisão visual

Cobertura automatizada (SSR/HTML contracts, zoom 100%):

- Viewport **1366×768** — `salesOrderFlowUiValidationMatrix.test.ts`
- Viewport **1920×1080** — idem
- Coluna com scroll vertical; cards sem sobreposição de header
- Drawer / deep link / filtros URL

Smoke humano no servidor permanece no passo 20 do `deployment-runbook.md`.

---

## 12. Limitações dependentes do servidor

1. Sem acesso Cursor → produção DB  
2. Latência real e EXPLAIN só no host  
3. Backup / migrate / restart / flag ON — operação  
4. Seed de permissões novas (se ainda não aplicados no ambiente)  
5. Dados Nomus precisam estar sincronizados antes do rebuild  
6. `producedQuantity` / ship date ainda não normalizados no stage (inconsistências INFO/WARNING)

---

## 13. Sequência de deploy

Ver `deployment-runbook.md` (21 passos). Cola:

```text
backup → pull → migrate → generate → build → restart
flag OFF → rebuild preview → piloto → audit → backfill
medir → flag ON → permissões → tela → rollback ensaiado
```

---

## 14. Commits da cadeia (OP-45 … OP-79)

Ordem cronológica (`git log --grep=sales-order-flow`):

| SHA | Assunto | OP |
|-----|---------|-----|
| `73af599` | audit current lifecycle sources | 45 |
| `7c7063a` | define lifecycle state machine | 46 |
| `2cb66a4` | map sales order release status | 47 |
| `d57aff3` | resolve item production requirement | 48 |
| `fe98ee1` | load canonical lifecycle evidence | 49 |
| `97033c2` | calculate lifecycle per order item | 50 |
| `7bab0cd` | consolidate lifecycle by order | 51 |
| `4782b46` | add lifecycle snapshot schema | 52 |
| `f08652e` | add lifecycle repositories | 53 |
| `7ff09be` | persist lifecycle recomputation | 54 |
| `9b86b06` | track stage transitions and timeline | 55 |
| `88d57c1` | add lifecycle rebuild workflow | 56 |
| `630b715` | recompute after source synchronization | 57 |
| `37a4fc5` | add controlled feature activation | 58 |
| `d3828b2` | add kanban summary API | 59 |
| `412bb17` | add paginated kanban API | 60 |
| `f661bfa` | add lifecycle detail and events APIs | 61 |
| `bc1e531` | add workflow management actions | 62 |
| `762fd8e` | enforce granular access and scope | 63 |
| `7609ecf` | add persistent kanban filters | 65 |
| `6ac7b93` | add filtered flow indicators | 66 |
| `63c3217` | render operational kanban board | 67 |
| `639da88` | paginate kanban columns independently | 68 |
| `5fbb1ea` | add summary and item flow drawer | 69 |
| `1f73650` | add production document and shipment details | 70 |
| `f7030d5` | add lifecycle timeline and inconsistencies | 71 |
| `8153d98` | unify commercial access scope (CRM) | escopo |
| `8c53080` / `9cf8e75` | management panel + wire routes | 72 |
| `e153fa9`…`91de81a` | sync docs / UI tests | 69–73 |
| `86b02d8` | finalize kanban navigation | 64/73 |
| `fc3ac02` | lifecycle observability | 74 |
| `3f355ed` | optimize kanban data access | 75 |
| `7bb6dc1` | complete lifecycle engine matrix | 76 |
| `cf34520` | validate kanban APIs and interface | 77 |
| `aa3b31e` | production lifecycle audit | 78 |
| `27d8a95` / `ddcd054` | controlled deployment runbook | 79 |
| *(este commit)* | finalize commercial kanban module | **80** |

---

## 15. Veredito

**Código pronto como Release Candidate** para implantação controlada no servidor, com feature flag desligada até piloto + auditoria + backfill.

Não é go-live automático: seguir `deployment-runbook.md` e só então ativar `COMMERCIAL_SALES_ORDER_FLOW_ENABLED=true`.
