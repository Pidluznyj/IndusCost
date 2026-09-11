# CRM > Relatórios — motor de recompra e listas operacionais (V1)

**Decisão (11/09/2026):** a aba CRM > Relatórios nasce SEM régua própria de
pedido. Compra = **Pedido de Venda canônico** (mesma população da tela
Comercial > Pedidos de Venda), data da compra = **`SalesOrder.issueDate`**.
Esta entrega é backend + contratos; a interface visual vem depois.

Branch: `feat/crm-reports-repurchase-engine` · base `main@f3369eeb`.

## Eixos (não misturar)

| Eixo | Fonte | Papel |
|---|---|---|
| Compra | `SalesOrder` via `crmCanonicalSalesOrderWhere` | quantidade, valor, recompra |
| Carteira | `CrmCustomerCommercialOwner` ativo (Responsável Comercial) | escopo/acesso e filtro |
| Vendedor Nomus | `SalesOrder.externalSellerId` do **último** pedido | exibição/filtro de auditoria — nunca escopo, nunca recorta a cadência |
| Relacionamento | `CommercialActivity` | só enriquecimento da lista de atrasados |

NF, proposta, atividade e comissão **não criam compra**. `settlementDate` /
`receiptDate` não são usados.

## Onde cada regra mora (uma implementação só)

| Regra | Implementação canônica consumida |
|---|---|
| Pedido válido (status ≠ CANCELLED — ERROR entra —, presença Nomus, grupo econômico fora) | `crmCanonicalSalesOrderWhere({ allYears: true }, { ignorePeriod: true })` → `buildSalesOrderListWhere` |
| Cliente elegível (ativo, fora do grupo) | `crmEligibleCustomerWhere()` (extraído de `crmManagementOrderFacts.server.ts`, mesmos predicados) |
| Carteira do usuário / filtro de responsável | `resolveCrmCustomerListSellerScopeFilter` + `fetchCrmManualOwnerCustomerIds` (mesma carteira da Carteira de Clientes) |
| Escopo de acesso | `requireCrmCommercialDataScope` (global / own / none) |
| Nome do responsável | `resolveCommercialResponsibleMap` |
| Vendedor do último pedido (filtro) | `buildSalesOrderNomusSellerWhereFromSellerKey` / `buildSalesOrderNomusSellerWhereFilter` (vocabulário da tela Pedidos) |
| Vendedor do último pedido (rótulo) | `buildSalesOrderNomusSellerDto` + `formatSalesOrderNomusSellerListLabel` |
| Follow-up | `aggregateCustomerActivities` (semântica da Carteira de Clientes) |
| Dia civil local | `nomusDateTimeToCivilKey`, `financeCivilDate` (`addCivilDays`/`diffCivilDays`) |
| Ticket médio | `computeTicketAverage` |

Módulos novos (`src/lib/commercial/`):

- `crmReportsTypes.ts` — contratos (importável pelo frontend).
- `crmRepurchaseEngine.ts` — motor **puro** (sem Prisma/Express/React).
- `crmReportsOperationalCore.ts` — núcleo puro: parser, agregação, universo, indicadores, listas, paginação, DTO.
- `crmReportsOperationalService.server.ts` — I/O em lote.
- `crmReportsRoutes.ts` — `POST /api/crm/reports/operational`.
- `crmReportsVerification.server.ts` + `scripts/verify-crm-reports-vs-sales-orders.ts` — verificador read-only.
- `crmReportsSourceGuard.ts` — guard estático.

## Motor `LAST_6_DISTINCT_PURCHASE_DAYS_MEAN_V1`

- **Ocasião de compra** = dia de calendário **local** distinto de `issueDate`.
  PD 1 às 08h, PD 2 às 12h e PD 3 às 16h do mesmo dia = 3 pedidos (quantidade/valor) e **1 ocasião** (recompra).
- Usa as **últimas 6 ocasiões** do histórico **inteiro** (sem o horizonte de 24 meses do cockpit) → no máximo **5 intervalos**.
- Média aritmética simples dos intervalos, precisão interna total. Arredonda
  (meio para cima) **só** para achar a data esperada.
- `expectedRepurchaseDate = última ocasião + round(média)`.
- `deltaDays = hoje − data esperada` (dias de calendário; nunca ms/24h).
- Sem remoção de outliers na V1.

| Ocasiões | Confiança |
|---|---|
| 0 ou 1 | NONE |
| 2 | LOW |
| 3 ou 4 | MEDIUM |
| 5+ | HIGH |

| Situação | Status |
|---|---|
| 0 compras | `NO_HISTORY` |
| 1 ocasião | `INSUFFICIENT_HISTORY` |
| delta < −15 | `ON_TIME` |
| −15 ≤ delta ≤ 0 | `DUE_SOON` |
| 1 ≤ delta ≤ 30 | `OVERDUE` |
| delta > 30 | `SEVERELY_OVERDUE` |

## Janelas (dia civil local do servidor)

- **60d** = hoje + 59 dias anteriores. Ex.: hoje 11/09/2026 → 14/07/2026…11/09/2026.
- **12m** = (hoje − 12 meses) + 1 dia … hoje. Ex.: 12/09/2025…11/09/2026 (fim de mês ajustado: 29/02 − 12 meses = 28/02).
- Pedido com emissão **depois de hoje** fica fora das janelas e da cadência e é
  contado em `sourceInfo.futureDatedOrdersIgnored` (nunca silencioso).

## Pipeline e universo

```
AUTH → escopo (global | own; none = 403)
  → autorizados: ativo ∧ fora do grupo ∧ (own ⇒ carteira do usuário)      = authorizedCustomers
  → inclusão: cliente(s), responsável (só global), cidade, UF,
              vendedor do último PV                                        = matchedBeforeExclusions
  → seleção analítica EXCLUDE / ONLY                                      = manuallyExcluded
  → universo analisado                                                    = analyzedCustomers
  → indicadores + RECENT_60D + CADENCE + OVERDUE (mesmo universo)
```

- `own` sem vínculo comercial → universo vazio (`blockedReason: SELLER_NOT_LINKED`), sem consultar o banco global.
- Filtro de responsável enviado por usuário `own` é **ignorado** (`scope.commercialOwnerFilterIgnored = true`) — a carteira do usuário é forçada.
- `ONLY` com cliente fora do escopo: o ID é ignorado e contado em `selection.idsOutsideUniverse`.
- Vendedor do último pedido **não amplia acesso**: é aplicado sobre clientes já autorizados.
- A cadência usa **todas** as compras válidas do cliente, qualquer que seja o vendedor.

## Indicadores × listas (reconciliam por construção)

| Indicador | Regra | Reconcilia com |
|---|---|---|
| `customersPurchased60d` | última compra dentro dos 60d | `recent60d.total` |
| `repurchaseDueNext15d` | −15 ≤ deltaDays ≤ 0 | status `DUE_SOON` |
| `overdueRepurchase` | deltaDays > 0 | `overdueRepurchase.total` |
| `severelyOverdueRepurchase` | deltaDays > 30 | subconjunto de `overdueRepurchase` |
| `insufficientCadence` | 1 ocasião | linhas `INSUFFICIENT_HISTORY` da cadência |

A lista OVERDUE **não recalcula**: filtra o resultado do motor
(`OVERDUE` + `SEVERELY_OVERDUE`). `total` de cada lista é o tamanho da lista
inteira — nunca o da página.

## Contrato — `POST /api/crm/reports/operational`

Guardas: sessão → `commercial.crm.portfolio:view` → `requireCrmCommercialDataScope`.
Leitura via POST porque `customerIds` pode ser grande (até 20.000 IDs).

Request (tudo opcional):

```json
{
  "filters": {
    "customerIds": ["<uuid>"],
    "commercialOwner": { "sellerIdentityKey": "gislene lima", "externalSellerId": 464, "externalSellerIds": [464] },
    "lastOrderSeller": { "sellerKey": "501", "sellerName": "Joseane" },
    "city": ["Curitiba"],
    "state": "PR",
    "customerSelection": { "mode": "EXCLUDE", "customerIds": ["<uuid>"] }
  },
  "pagination": {
    "recent":  { "limit": 50, "offset": 0 },
    "cadence": { "limit": 50, "offset": 0 },
    "overdue": { "limit": 50, "offset": 0 }
  }
}
```

- `limit` padrão 50, máximo 100; `offset` ≥ 0.
- `customerIds`: filtro de **inclusão** (conta em `matchedBeforeExclusions`); vazio/ausente = sem filtro; ID fora do escopo é ignorado.
- `customerSelection.mode`: seleção **analítica** (conta em `manuallyExcluded`) — `ALL` (ignora IDs) · `EXCLUDE` · `ONLY` (lista vazia ⇒ universo vazio).
- `lastOrderSeller.sellerKey`: ID Nomus ou `__NO_SELLER__` (prioridade sobre `sellerName`).
- Filtro inválido ⇒ **400** `{ error: "VALIDATION", message, details[] }` — nunca ignorado.

Resposta 200 (`CrmReportsOperationalResponse`):

```json
{
  "asOf": "2026-09-11T13:00:00.000Z",
  "windows": { "today": "2026-09-11", "recent60d": { "from": "2026-07-14", "to": "2026-09-11", "days": 60 }, "rolling12m": { "from": "2025-09-12", "to": "2026-09-11", "months": 12 } },
  "scope": { "dataScope": "global", "sellerLinked": true, "blockedReason": null, "blockedMessage": null, "commercialOwnerFilterApplied": false, "commercialOwnerFilterIgnored": false },
  "selection": { "mode": "ALL", "requestedIds": 0, "idsOutsideUniverse": 0 },
  "appliedFilters": { "customerIds": [], "commercialOwner": null, "lastOrderSeller": null, "cities": [], "states": [], "customerSelection": { "mode": "ALL", "customerIds": [] } },
  "sourceInfo": {
    "orderSource": "SalesOrder",
    "dateAxis": "SalesOrder.issueDate",
    "businessDateAxis": "LOCAL_CALENDAR_DAY",
    "businessTimeZone": "America/Sao_Paulo",
    "validitySource": "crmCanonicalSalesOrderWhere → buildSalesOrderListWhere (população oficial da tela Pedidos de Venda, grupo econômico excluído)",
    "portfolioAxis": "RESPONSAVEL_COMERCIAL_CLIENTE",
    "orderSellerAxis": "AUDIT_ONLY",
    "relationshipSource": "CommercialActivity (enriquecimento; não cria compra)",
    "repurchaseVersion": "LAST_6_DISTINCT_PURCHASE_DAYS_MEAN_V1",
    "historyWindow": "FULL_HISTORY",
    "proposalsUsedAsPurchase": false,
    "invoicesUsedAsPurchase": false,
    "commissionsUsedAsPurchase": false,
    "truncated": false,
    "ordersLoaded": 18342,
    "futureDatedOrdersIgnored": 0
  },
  "universe": { "authorizedCustomers": 2140, "matchedBeforeExclusions": 2140, "manuallyExcluded": 0, "analyzedCustomers": 2140 },
  "indicators": { "customersPurchased60d": 312, "repurchaseDueNext15d": 41, "overdueRepurchase": 188, "severelyOverdueRepurchase": 120, "insufficientCadence": 97 },
  "recent60d":         { "rows": ["…"], "total": 312, "limit": 50, "offset": 0, "returned": 50, "hasMore": true, "sort": ["lastPurchaseDate:desc", "displayName:asc"] },
  "repurchaseCadence": { "rows": ["…"], "total": 1340, "limit": 50, "offset": 0, "returned": 50, "hasMore": true, "sort": ["displayName:asc"] },
  "overdueRepurchase": { "rows": ["…"], "total": 188, "limit": 50, "offset": 0, "returned": 50, "hasMore": true, "sort": ["deltaDays:desc", "purchaseValue12m:desc", "displayName:asc"] }
}
```

(números ilustrativos)

Linhas (campos completos em `crmReportsTypes.ts`):

- **RECENT_60D** (`CrmReportsRecent60dRow`): cliente, CNPJ, cidade/UF, responsável, vendedor do último pedido, última compra, dias desde a última compra, pedidos/valor/ticket 60d, média, esperada, delta, status, confiança.
- **CADENCE** (`CrmReportsCadenceRow`): cliente, responsável, ocasiões disponíveis/usadas, média, última compra, esperada, delta, confiança, status, pedidos/valor/ticket 12m. Inclui compra única (`INSUFFICIENT_HISTORY`).
- **OVERDUE** (`CrmReportsOverdueRow`): cliente, responsável, vendedor do último pedido, última compra, média, esperada, atraso (`overdueDays` = deltaDays), confiança, pedidos/valor/ticket 12m, `lastContactAt`, `nextFollowUpAt`, `hasOverdueFollowUp`.

Dinheiro: soma exata em micro-unidades (Decimal(20,6)); DTO em centavos.
`averageRepurchaseDays` com 2 casas; `averageRepurchaseDaysRounded` é o que soma à data.

Erros: 401 sem sessão · 403 escopo `none` · 400 filtro inválido · **422**
`REPORT_UNIVERSE_TOO_LARGE` se a carga passar de 400.000 pedidos (falha
explícita — nunca devolve número truncado) · 500 genérico.

## Performance

- Clientes: 1 consulta (global) ou lotes de 1.000 IDs da carteira (own).
- Pedidos: `crmCanonicalSalesOrderWhere` + `customerId IN (lote de 1.000)` — nº de consultas = ⌈clientes/1.000⌉, **nunca** uma por cliente.
- Sem filtro de vendedor, `EXCLUDE`/`ONLY` carregam pedidos só dos clientes que serão analisados.
- Enriquecimento (responsável, vendedor, follow-up) só das linhas das 3 páginas (≤ 150 clientes), em lote.
- Nada é materializado nem cacheado.

**Índices existentes (auditoria da `main`):**

- `SalesOrder`: `(customerId)`, `(customerId, issueDate)`, `(status)`, `(issueDate)`, `(externalSellerId)`, `(sourcePresenceStatus)`, `(createdAt desc, issueDate desc)`, `orderCode @unique`.
- `CommercialActivity`: `(customerId)`, `(customerId, contactDate)`, `(nextActionAt)`, `(status)`.
- `CrmCustomerCommercialOwner`: `customerId @unique`, `(sellerIdentityKey)`, `(sellerExternalId)`, `(isActive)`.
- `Customer`: `taxId @unique`, `(personId)`, `(contactPersonId)`, `(nomusExternalPersonId)`.

**Nenhuma migration.** O filtro de pedido por lote de `customerId` é coberto
por `(customerId)` / `(customerId, issueDate)`. Índice novo só se o EXPLAIN em
homologação provar necessidade (`scripts/explain-crm-reports-queries.ts`).

## Guard

`crmReportsSourceGuard.test.ts` varre os módulos novos (sem comentários) e
falha se aparecer: literal de status de SalesOrder / `status: {…}` /
`NOT IN ('CANCELLED','ERROR')` / `notIn`, SQL cru, Proposta, NF, comissão,
`settlementDate`/`receiptDate`, vendedor Nomus ou `SalesOrder.responsible`
como escopo, ms/24h, horizonte de 24 meses, escrita/cache, Prisma/Express/React
no motor/núcleo, `CommercialActivity` no cálculo. Também exige o consumo de
`crmCanonicalSalesOrderWhere` e da carteira por `CrmCustomerCommercialOwner`.

## Verificador (homologação, read-only)

```bash
npx tsx scripts/verify-crm-reports-vs-sales-orders.ts
npx tsx scripts/verify-crm-reports-vs-sales-orders.ts --customer=<uuid>
npx tsx scripts/verify-crm-reports-vs-sales-orders.ts --json
```

Lado oficial = `buildSalesOrderListWhere(…, { excludeEconomicGroupCustomers: true })`
com o recorte Emissão de/até da tela, agregado no banco (`groupBy`). Lado
relatório = `runCrmReportsAnalysis` (pipeline do endpoint, escopo global). Por
cliente: pedidos 60d/12m (delta 0), valor 60d/12m (R$ 0,00), última compra
(igual). Cliente elegível ausente = divergência; cliente INATIVO com pedido =
aviso (regra). Sai com código 1 se divergir.

## Limitações conhecidas (V1)

- Sem remoção de outliers; um intervalo anômalo entre as 6 últimas ocasiões pesa na média.
- "Hoje" é o dia civil do fuso do servidor (`sourceInfo.businessTimeZone`) — o mesmo do filtro canônico de emissão.
- Clientes INATIVOS ficam fora (regra de elegibilidade), mesmo com pedido.
- Custo por request cresce com o histórico do universo (histórico inteiro); protegido por teto explícito (422). Sem cache nesta versão.
- O endpoint avançado/construtor não faz parte desta entrega.
