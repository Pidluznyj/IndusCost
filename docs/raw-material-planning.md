# Planejamento de Matéria-Prima (Orquestrador de Compra)

Tela: Suprimentos > Planejamento de Matéria-Prima (`/materials/planning`).

## Objetivo

Responder, para cada matéria-prima: o que comprar, quanto, até quando e com
que confiança — cruzando saldo de estoque contado, proteção mínima +
contingência, demanda dos pedidos de venda ainda em aberto e entradas de
compra já confirmadas. Antes desta tela, essas informações existiam
separadas: o saldo contado (Suprimentos > Conferência de Estoque) e a
demanda estimada (Comercial > Pedidos de Venda > Inteligência de
Matéria-Prima) — ninguém juntava as duas com proteção de estoque e prazo de
compra.

## O que NÃO é

- Não é MRP completo (não considera capacidade de produção, sequenciamento,
  nem múltiplos níveis de estoque/almoxarifado).
- Não altera `Material.quantity` nem qualquer outro dado — é só leitura e
  projeção.
- Não cria pedidos de compra nem prioriza pedidos de venda automaticamente.
- Não inventa lead time, data de necessidade ou fator de conversão de
  unidade quando a informação não existe — nesses casos marca
  `DATA_INCOMPLETE` / `UNIT_CONVERSION_ERROR` e explica o motivo.

## Fontes de dados (nenhuma nova, nenhuma migration)

| Dado | Fonte |
|---|---|
| Saldo contado de MP | `Material.quantity` |
| Estoque mínimo / contingência | `Material.minimumQuantity` / `Material.contingencyQuantity` |
| Última contagem | `Material.lastStockConferenceAt` |
| Demanda (explosão de BOM) | mesmo motor Open Book de "Inteligência de Matéria-Prima" (`buildOpenBookRawMaterialExplosionPerUnit`) |
| Quantidade em aberto por item de pedido | `SalesOrderItem.nomusQuantityPending` (líquida de `nomusIsCut`/`nomusIsCanceled`) |
| Data de necessidade | `SalesOrder.expectedDeliveryDate` (única data confiável disponível hoje) |
| Entrada de compra confirmada | `PurchaseOrderItem` em `PurchaseOrder.status` ∈ {APROVADO, ENVIADO, EMITIDO, CONFIRMADO, PARCIALMENTE_RECEBIDO}, líquida de `PurchaseReceiptItem.quantityAccepted` |
| Lead time | média das últimas `PurchaseOrderItem.leadTimeDaysSnapshot` do material (histórico real de compras) |
| Limiares de contagem desatualizada | `IndirectCost` (`category: "GLOBAL_PARAM"`, chaves `MATERIAL_PLANNING_STALE_DAYS` / `MATERIAL_PLANNING_ATTENTION_DAYS`), fallback 7/3 dias |

## Divergência deliberada da Inteligência de Matéria-Prima existente

A tela de Comercial > Pedidos de Venda > Inteligência de Matéria-Prima usa a
quantidade **cheia** do item do pedido (`item.quantity`). Esta nova tela usa
a quantidade **ainda em aberto** (`nomusQuantityPending`, zerada quando
`nomusIsCut` ou `nomusIsCanceled`), porque o objetivo aqui é decisão de
compra — comprar para atender pedido já parcialmente entregue ou cortado
infla a necessidade real. Quando `nomusQuantityPending` é `null` (pedido
nunca sincronizado por status Nomus), usa a quantidade cheia como
aproximação conservadora e sinaliza isso em `dataQuality.itemsWithoutFulfillmentStatus`.

## Fórmulas centrais (`src/lib/rawMaterialPlanning.shared.ts`, sem Prisma)

- **Proteção total** = `minimumQuantity + contingencyQuantity` (limiar
  constante ao longo do horizonte, nunca somado ao saldo físico).
- **Projeção diária** (`projectRawMaterialBalance`): a partir do saldo
  contado, aplica entradas confirmadas e saídas por demanda em ordem
  cronológica; `saldo livre = saldo projetado − proteção total`;
  `firstRiskDate` = primeira data em que o saldo livre fica negativo.
- **Necessidade técnica** = `max(0, proteção total − menor saldo projetado
  no horizonte)` — calculada diretamente da mesma projeção mostrada na
  linha do tempo, garantindo que o número do resumo sempre reconcilie com o
  detalhe (mesma classe de bug de divergência resumo×detalhe já corrigida
  em outras telas do sistema).
- **Quantidade sugerida** (`calculatePurchaseRecommendation`): necessidade
  técnica ajustada a lote mínimo/múltiplo de compra **somente se
  cadastrados** (hoje não há esse cadastro em `Material` — o ajuste fica
  documentado como lacuna, não como bug).
- **Data limite de compra** (`calculateBuyByDate`) = data de risco − lead
  time − 2 dias de aprovação interna − 2 dias de margem logística. Sem lead
  time confiável, nunca inventa uma data — marca `blockedReason:
  "NO_LEAD_TIME"`.
- **Situação** (`classifyRawMaterialPlanningStatus`) — precedência fixa:
  1. `UNIT_CONVERSION_ERROR` (sempre primeiro).
  2. `STOCK_COUNT_STALE` (contagem velha demais para confiar em qualquer
     número).
  3. Sem risco no horizonte → `COVERED_BY_STOCK` / `COVERED_BY_CONFIRMED_INBOUND`.
  4. Há risco mas falta lead time → `DATA_INCOMPLETE`.
  5. Há risco e entrada confirmada: chega antes → `COVERED_BY_CONFIRMED_INBOUND`;
     chega depois e ainda falta comprar → `PARTIALLY_COVERED`; chega depois
     e cobre tudo → `INBOUND_LATE`.
  6. Há risco sem entrada suficiente → `BUY_NOW` / `BUY_WITHIN_7_DAYS` /
     `PLAN_PURCHASE`, conforme dias até a data limite.
- **Confiança** (`calculatePlanningConfidence`) — indicador **operacional**
  de qualidade dos dados (não estatístico): soma penalidades (unidade
  incompatível, lead time ausente, contagem ausente/desatualizada, pedidos
  sem data de necessidade, entrada não confirmada) e satura em
  LOW (≥4) / MEDIUM (≥2) / HIGH (<2).

## Unidades

Reaproveita `normalizeMaterialUnitKey` (`src/lib/materialDemandUnits.ts`) —
normaliza variações de grafia da MESMA unidade (kg/kgs/quilograma), mas não
converte entre unidades diferentes. Uma entrada de compra com unidade
diferente da cadastrada no material nunca é somada silenciosamente à
cobertura — gera `UNIT_CONVERSION_ERROR` e fica marcada com ⚠ na tela.

## Permissões / navegação

- Recurso canônico: `engineering.materials.planning` (view), família
  `engineering.materials.*` (`src/lib/engineeringAccess.ts`).
- Contrapartida de aba: `suprimentos.tab.planejamento_materia_prima`
  (`src/lib/moduleTabResources.ts`, `src/lib/permissionResourceSeedData.ts`,
  `src/lib/security/permissionContract/resources.ts`).
- Rota: `src/lib/materialsNavigation.ts` (`planning`), montada em
  `src/components/MaterialsModule.tsx` como a 4ª aba do módulo Suprimentos.
- Endpoints protegidos por `requireAppAuth` + `requireResource("engineering.materials.planning", "view")`.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/materials/planning` | Lista completa (sem paginação server-side) + resumo executivo + `dataQuality` + `warnings` |
| GET | `/api/materials/planning/:materialId` | Mesma engine, filtrada a 1 material — usada para reconciliar resumo×detalhe |
| GET | `/api/materials/planning/export.csv` | CSV (BOM + `;` + `csvEscape`), respeitando os mesmos filtros |

Filtros de querystring: `asOfDate`, `horizon` (30/60/90/custom +
`horizonEndDate`), `situation` (repetível), `search`, `supplier`,
`companyIssuer`, `customerId`, `productId`, `materialId`,
`onlyWithPurchaseNeed`.

A paginação da grade (`page`/`pageSize` no frontend) é só de exibição — o
backend devolve todas as matérias-primas do filtro de uma vez e o cliente
fatia localmente.

## Frontend

- `src/components/materials/RawMaterialPlanningPage.tsx` — filtros, KPIs
  executivos (`ContextualDashboardKpiGrid`/`ContextualDashboardKpiCard`,
  reaproveitados de `MaterialDemandDashboardPanels`), grade principal,
  exportação CSV (blob download), atalhos rápidos por situação (Comprar
  agora / Comprar em 7 dias / Em risco / Contagem desatualizada / Sem lead
  time / Erro de unidade).
- `src/components/materials/RawMaterialPlanningTable.tsx` — grade com linha
  expansível mostrando: alertas, memória do cálculo (cada número com sua
  origem), linha do tempo projetada, pedidos de venda consumidores,
  entradas de compra confirmadas.
- `src/components/materials/rawMaterialPlanningUi.ts` — labels/tons/
  formatação pura (sem fetch, sem Prisma).

## Fora de escopo desta entrega (lacuna documentada, não bug)

- Ação "Criar solicitação de compra" — não há hoje um fluxo de 1 clique
  reaproveitável sem risco de duplicar regra do módulo Compras SC.
- Gráfico dedicado da linha do tempo — a tabela já expõe o mesmo dado;
  gráfico fica para uma entrega futura se houver demanda.
- Priorização automática de pedidos de venda — a tela mostra cobertura por
  pedido, mas não altera prioridade/sequenciamento.
- Lote mínimo / múltiplo de compra por material — não há esse cadastro
  hoje em `Material`; quando ausente, a quantidade sugerida é a
  necessidade técnica pura, sem ajuste, e isso fica explícito na UI
  (`adjustmentNote: null`).

## Testes

- `src/lib/rawMaterialPlanning.shared.test.ts` — 33 testes `node:test` da
  engine pura: cobertura total, proteção violada, entrada antes/depois do
  risco, cobertura parcial, sem lead time, contagem desatualizada,
  conversão de unidade inválida, determinismo (mesmo `asOfDate` → mesmo
  resultado), todos os ramos de precedência de `classifyRawMaterialPlanningStatus`,
  todos os fatores de `calculatePlanningConfidence`, `resolveRawMaterialNeedByDate`
  nunca cai para o relógio, `resolveRawMaterialPlanningHorizonEndDate` para
  30/60/90/custom.
- A camada de orquestração Prisma (`rawMaterialPlanning.server.ts`) segue o
  mesmo padrão já estabelecido no projeto para `buildMaterialDemandDataset`:
  sem teste automatizado de integração nesta entrega (precisa de banco
  local, indisponível nesta sessão) — validada via typecheck +
  `check:server-imports`/`check:frontend-server-imports` + build de
  produção, mas **não foi exercitada com dados reais**.

## Limitações conhecidas

- O saldo contado é tão atual quanto a última conferência de estoque — não
  reflete movimentações de fábrica em tempo real. A situação
  `STOCK_COUNT_STALE` e o indicador de confiança existem justamente para
  deixar isso explícito, nunca escondido atrás de um número calculado.
- A data de necessidade usa `expectedDeliveryDate` do pedido — não existe
  hoje no sistema uma data planejada de início de produção; se um dia
  existir, deve ganhar prioridade sobre `expectedDeliveryDate` nesta mesma
  função (`resolveRawMaterialNeedByDate`).
- Sem banco de dados local nesta sessão, a tela não foi validada
  visualmente com dados reais — só via `node:test`, `tsc --noEmit`, checks
  de fronteira frontend/server e build de produção.
