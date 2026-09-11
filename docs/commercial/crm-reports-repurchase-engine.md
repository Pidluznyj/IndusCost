# CRM > Relatórios — motor de recompra, listas, relatório personalizado e aba (V1)

**Decisão (11/09/2026):** a aba CRM > Relatórios nasce SEM régua própria de
pedido. Compra = **Pedido de Venda canônico** (mesma população da tela
Comercial > Pedidos de Venda), data da compra = **`SalesOrder.issueDate`**.

Entregas: (1) motor + listas operacionais + endpoint + verificador
(`feat/crm-reports-repurchase-engine`, base `main@f3369eeb`); (2) aba completa
na UI, relatório personalizado e exportação CSV/XLSX (`feat/crm-reports-ui`,
empilhada sobre a 1). O backend da entrega 1 é a fonte única: a UI, o
personalizado e a exportação só consomem o mesmo pipeline.

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

Módulos (`src/lib/commercial/`):

- `crmReportsTypes.ts` — contratos (importável pelo frontend).
- `crmRepurchaseEngine.ts` — motor **puro** (sem Prisma/Express/React).
- `crmReportsOperationalCore.ts` — núcleo puro: parser, agregação, universo, indicadores, visões, listas, paginação, DTO.
- `crmReportsOperationalService.server.ts` — I/O em lote (listas, opções de filtro, busca de clientes).
- `crmCustomReportContract.ts` — disponibilidade de métrica por granularidade (fonte única backend + UI).
- `crmCustomReportCore.ts` / `crmCustomReportService.server.ts` — relatório personalizado (consome `runCrmReportsAnalysis`).
- `crmReportsExport.ts` / `crmReportsExportService.server.ts` — CSV/XLSX com o mesmo spec da tela.
- `crmReportsLabels.ts` — rótulos PT compartilhados entre tela e arquivo.
- `crmReportsRoutes.ts` — as 6 rotas da aba.
- `crmReportsVerification.server.ts` + `scripts/verify-crm-reports-vs-sales-orders.ts` — verificador read-only.
- `crmReportsSourceGuard.ts` — guard estático (backend e UI).
- Frontend: `crmReportsClient.ts` (HTTP), `crmReportsUiState.ts` (estado/requests), `crmReportsTemplates.ts` (8 modelos), `crmReportsFormat.ts` (formatação) e `src/components/crm/reports/*`.

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

Guardas: sessão → `commercial.crm.reports:view` (recurso da aba Relatórios;
relacional `comercial.crm.tab.relatorios`) → `requireCrmCommercialDataScope`.
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
  "views": {
    "cadence": { "statuses": ["DUE_SOON"] },
    "overdue": { "severity": "SEVERE", "sort": "VALUE_12M_DESC" }
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
- `views` só **selecionam/ordenam** o resultado do motor (cards clicáveis): `cadence.statuses` (vazio = todos), `overdue.severity` `ALL` | `SEVERE` (> 30 dias), `overdue.sort` `DELAY_DESC` (padrão) | `VALUE_12M_DESC`. Não mudam universo nem indicadores; ecoadas em `appliedViews`.
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

## Endpoints da aba (todos: sessão → `commercial.crm.reports:view` → escopo CRM; nenhum escreve)

| Rota | Uso | Quando a UI chama |
|---|---|---|
| `POST /api/crm/reports/operational` | universo, 5 indicadores, 1 página de cada lista | abertura, filtro, visão, página, "Atualizar" |
| `GET /api/crm/reports/filter-options` | responsáveis, vendedores do último pedido, cidades, UFs (agregados, sem lista de clientes) | abertura (1×) |
| `GET /api/crm/reports/customer-options?q=` / `?ids=` | busca escopada por nome, fantasia ou CNPJ (≥ 2 caracteres, até 50) | digitação (debounce 300 ms, pedido obsoleto cancelado) |
| `POST /api/crm/reports/custom` | relatório personalizado paginado + totais + subtotais | **só** no clique "Gerar relatório" (e paginação do resultado gerado) |
| `POST /api/crm/reports/operational/export` | lista 1/2/3 inteira em CSV/XLSX (`list`, `format` + o mesmo corpo da tela) | botão CSV/XLSX da lista |
| `POST /api/crm/reports/custom/export` | personalizado inteiro em CSV/XLSX (spec gerado) | botão CSV/XLSX do resultado |

## Relatório personalizado (construtor)

Mesmo pipeline das listas (`runCrmReportsAnalysis`: escopo, carteira, filtros,
clientes ocultados, população canônica) + agregação pura em
`crmCustomReportCore`. Não existe consulta própria de pedido (guard
`PARALLEL_ORDER_QUERY`).

- **Dimensões (até 3):** Cliente, Responsável Comercial, Vendedor do pedido, Mês, Ano, Cidade, UF.
- **Métricas:** Valor vendido, Pedidos, Clientes (distintos), Ticket médio, Última compra, Dias sem compra, Tempo médio de recompra, Dias de atraso.
- **Período** = emissão do pedido (dia civil); a UI deriva os atalhos das janelas do backend (`windows`) — nenhuma conta de data no navegador.
- **Situação do cliente:** com compra no período · sem compra no período · recompra atrasada · recompra nos próximos 15 dias (situação vem do motor).
- **Disponibilidade** (`crmCustomReportContract.ts`, a UI desabilita com o mesmo motivo; o backend recusa com 400): recência (Última compra, Dias sem compra) não combina com Vendedor do pedido/Mês/Ano; cadência (Tempo médio, Dias de atraso) só na granularidade Cliente; "Sem compra" não combina com dimensão de pedido.
- Com dimensão de pedido cada pedido cai em **uma** linha (sem dupla contagem). Paginação real (100/página, máx. 500), subtotais por "Agrupar por", total geral de **todas** as linhas; teto de 50.000 linhas ⇒ **422** `REPORT_TOO_LARGE` (nunca trunca).
- Margem, recebimento, propostas e produtos **não** entram nesta versão.
- **8 modelos** (`crmReportsTemplates.ts`) só preenchem o construtor: Vendas por Cliente · por Responsável Comercial · por Vendedor do Pedido · Responsável × Vendedor do Pedido · Clientes sem Compra · Evolução Mensal por Cliente · Atrasados para Recompra · Próximos a Recomprar. Todos validados pelo parser do backend nos testes.

## Exportação (CSV / XLSX)

- Mesmo corpo da tela (filtros + visões / spec gerado); a única diferença é a paginação: exporta a lista/relatório inteiro, com enriquecimento em lote.
- **Metadados no arquivo:** relatório, data/hora e fuso, usuário, escopo, filtros legíveis, clientes excluídos/selecionados (aba própria no XLSX), fonte (população canônica de Pedido de Venda), eixo de data (`SalesOrder.issueDate`, dia civil), versão do motor, janelas, universo, observações.
- Rótulos de cliente nos metadados só do universo autorizado: ID de outra carteira vira "(fora do universo — ignorado)".
- CSV no padrão do repositório (BOM, `# `, `;`, CRLF, vírgula decimal, dd/mm/aaaa) com proteção contra *formula injection* em texto; XLSX com números como números, autofiltro e total geral no rodapé.
- Nome: `crm-relatorio-<lista>-AAAAMMDD-HHmm.<csv|xlsx>`; cabeçalhos `Content-Disposition`, `Cache-Control: no-store`, `X-Export-Row-Count`.

## Aba CRM > Relatórios (UI)

`?tab=reports` · recurso `comercial.crm.tab.relatorios` (contrato
`commercial.crm.reports`, alias legado 1:1 `crm.reports.view`). O
`CrmModule` só faz aba/autorização/lazy/integração; a seção
(`CrmReportsSection`) é um chunk próprio carregado sob demanda.

Ordem na tela: cabeçalho (escopo, atualizado em, linhas por lista) → Filtros
(Cliente, **Responsável Comercial** — dono da carteira, **Vendedor do último
pedido** — auditoria Nomus, Cidade, UF) → Ocultar clientes (Todos / Excluir
selecionados / Somente selecionados, busca escopada, chips) → fonte + resumo
do universo (permitido, após filtros, ocultados, analisados — do backend) →
5 cards → Lista 1 "Compraram nos últimos 60 dias" → Lista 2 "Ciclo de
recompra" (chips de situação) → Lista 3 "Atrasados para recompra" (recorte
todos/> 30 dias, ordenação maior atraso/maior venda 12m) → Relatório
personalizado.

- **Abertura:** só `filter-options` + `operational` (1ª página das 3 listas). Nenhum personalizado, produto, margem, financeiro ou proposta; o dashboard de vendedores do CRM não é pré-carregado quando a aba abre direto em Relatórios.
- **Cards** são botões: selecionam a visão da lista (sem cálculo) e levam até ela; o backend garante card = total da lista filtrada.
- **Marcação por linha** (checkbox) → "Ocultar selecionados" (EXCLUDE) / "Mostrar somente selecionados" (ONLY): vai no request; cards, listas, personalizado e exportação mudam juntos.
- **Situação com texto** ("Atrasado · 17 dias", "Recompra em 8 dias", "Sem cadência suficiente"); confiança Sem histórico/Baixa/Média/Alta. Compra única nunca mostra previsão.
- **Ações por linha** (cada uma só aparece com a permissão da tela de destino): Cliente 360 = página canônica de Inteligência do Cliente (`/crm/customers/:id/intelligence`); Último pedido = `SalesOrderDetailDialog` (lazy); Registrar contato = modal canônico "Novo contato" do CRM (`POST /api/customers/:id/commercial-activities`), sem trocar de aba; ao salvar, só Relatórios recarrega.
- **Estados:** carregando, universo vazio, filtro sem resultado (com "Limpar filtros"), erro com "Tentar novamente", sem permissão (403 ⇒ aba inteira bloqueada), sem carteira vinculada, universo grande demais (422, sem truncar), pedidos com emissão futura e filtro de responsável ignorado (avisos).
- Filtros/seleção/visões ficam na `sessionStorage` **por usuário** (volta do Cliente 360 com o mesmo recorte); sem id de usuário nada é salvo.
- Sem `?tab`, perfil sem Gestão Geral abre na 1ª aba permitida (ex.: só Relatórios); deep-link para aba negada continua no modal de acesso negado (PERM-39).

## Permissões e rollout

| Papel (preset sem Perfil de Acesso) | `comercial.crm.tab.relatorios` |
|---|---|
| ADMIN | ver |
| COMMERCIAL_MANAGER | ver |
| SELLER | ver |
| VIEWER | — |

- Usuários **com Perfil de Acesso** (snapshot) só veem a aba depois que um administrador marcar "CRM — Relatórios" no perfil (Configurações > Perfis de Acesso). Perfis existentes não ganham acesso sozinhos.
- Além do recurso, os dados exigem escopo comercial do CRM (global ou carteira própria); sem escopo ⇒ 403 e a aba mostra "Sem permissão".
- Carteira própria: filtro de Responsável Comercial é ignorado (a carteira do usuário é forçada) e a busca/metadados só enxergam clientes dessa carteira.

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

Papéis adicionados na entrega 2: **consumer** (personalizado/exportação —
precisam chamar `runCrmReportsAnalysis` e não podem consultar pedido por
conta própria), **aggregation** (puro) e **ui** (componentes da aba + cliente
e estado do frontend: sem import de motor/núcleo/exportação/`.server`, sem
`rows.length`, sem conta de data/recompra, sem decisão por papel de
usuário). Todo `.tsx` de `src/components/crm/reports` precisa estar no guard.

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
- Custo por request cresce com o histórico do universo (histórico inteiro); protegido por teto explícito (422). Sem cache nesta versão: cada mudança de filtro/página refaz a análise (o pedido anterior é cancelado).
- Construtor V1 sem margem, recebimento, propostas e produtos (fontes canônicas ainda não ligadas a este pipeline).
- Filtros Cidade/UF são de seleção única na tela (o contrato aceita listas).
- "Registrar contato" usa o modal do CRM tal como é (sem edição de perfil nem timeline a partir de Relatórios).

## Homologação (passo a passo)

1. Garantir o recurso: usuário ADMIN / COMMERCIAL_MANAGER / SELLER sem Perfil de Acesso já vê a aba; para Perfil de Acesso, marcar "CRM — Relatórios" no perfil.
2. Abrir `CRM Comercial` → aba **Relatórios** (ou `/crm-commercial?tab=reports`). Conferir no DevTools (Rede) que só saem `GET filter-options` e `POST operational` — nenhum `custom`.
3. Rodar `npx tsx scripts/verify-crm-reports-vs-sales-orders.ts` (read-only) e anotar que sai sem divergência; comparar um cliente com `--customer=<uuid>` contra a tela Pedidos de Venda (Emissão nos últimos 60 dias / 12 meses).
4. Clicar cada card e conferir: número do card = contador da lista ("N clientes"); "Atrasados > 30 dias" ⊂ "Recompra atrasada".
5. Marcar 2 linhas → "Ocultar selecionados": "Ocultados" sobe 2, "Clientes analisados" cai 2 e os cards mudam. "Somente selecionados" → analisados = marcados. Voltar a "Todos os clientes".
6. Filtrar **Responsável Comercial** e depois **Vendedor do último pedido** (outra pessoa): a lista mostra as duas colunas diferentes (carteira × quem lançou o pedido).
7. Paginar a lista 1 (Próxima/Anterior) e trocar "Linhas por lista": o contador da lista não muda com a página.
8. Lista 3: alternar "Maior venda 12m primeiro"; abrir "Último pedido" (modal canônico do pedido) e "Cliente 360" (página Inteligência do Cliente); voltar e conferir que os filtros permanecem.
9. "Registrar contato" num atrasado → salvar → a lista recarrega com "Último contato".
10. Construtor: escolher "Responsável × Vendedor do Pedido" (não executa), clicar **Gerar relatório** (1 `POST custom`), mudar um filtro global (aviso "resultado desatualizado", sem nova consulta) e gerar de novo.
11. Exportar CSV e XLSX da lista 3 e do personalizado: conferir metadados (data/hora, usuário, filtros, clientes excluídos, fonte, eixo de data) e que o nº de linhas = contador da tela.
12. Usuário com escopo de carteira própria (Perfil de Acesso com "CRM — Relatórios" + `crm.seller.own`, sem Gestão Geral; o papel SELLER sem perfil é global por regra da persona): só clientes da carteira; o filtro de responsável aparece como "Sua carteira"; a busca de "Ocultar clientes" não encontra clientes de outra carteira. Usuário sem vínculo de Responsável Comercial: aviso "sem carteira vinculada".

**Não fazer deploy de produção a partir desta branch sem a homologação acima.**
