# Compras → Performance — Dashboard de Performance de Fornecedores

| | |
|---|---|
| **Módulo** | Compras (`/purchases/performance`) |
| **Abas** | Pedidos Nomus · Avaliação Fornecedor · **Performance** |
| **Natureza** | 100% leitura sobre o espelho Nomus já sincronizado. Sem writeback Nomus, sem schema novo, sem migration. |
| **Autoridade** | `DADO OFICIAL → REGRA SERVER-SIDE → READ MODEL → API → FRONTEND`. O frontend só formata. |

## 1. Arquitetura

```text
NomusPurchaseOrder / NomusPurchaseOrderItem / NomusPurchaseOrderSupplierEvaluation / NomusProductCatalog
        │  (Prisma, carga em lote — nº constante de consultas)
        ▼
src/lib/purchasing/supplierPerformanceDashboard.server.ts   loaders + orquestração
        ▼
src/lib/purchasing/supplierPerformanceDashboard.ts          motor PURO (população, agregações, rankings,
                                                             matriz, scorecard, detalhe de MP, registro de
                                                             indicadores avançados)
        ▼
src/lib/purchasing/supplierPerformanceDashboardRoutes.ts    GET /api/purchases/performance…
        ▼
src/lib/purchasing/supplierPerformanceDashboardClient.ts    fetch (browser-safe)
        ▼
src/components/purchases/performance/*                      página, seções, gráficos, matriz, overlays
```

Arquivos de apresentação: `supplierPerformanceDashboardUi.ts` (formatação/rótulos — nenhum cálculo).

### Rotas

| Método | Rota | Guard |
|---|---|---|
| GET | `/api/purchases/performance` | `requireAppAuth` + `requireResource(operations.purchases, view)` |
| GET | `/api/purchases/performance/supplier-materials` | idem (matriz paginada) |
| GET | `/api/purchases/performance/materials?q=` | idem (opções de MP por código/descrição, identidade por ID) |
| GET | `/api/purchases/performance/materials/:materialKey` | idem |
| GET | `/api/purchases/performance/suppliers/:supplierExternalId` | idem |

Nenhuma permission key nova: a aba usa a autoridade canônica do módulo Compras
(`operations.purchases:view`, mesma da Avaliação Fornecedor). A URL
`/purchases/performance` é resolvida como módulo `purchases` por
`RequirePathViewAccess`; usuário sem Compras é negado. Os endpoints estão
listados em `relatedEndpoints` de `operations.purchases` (contrato).

Filtro inválido enviado explicitamente → `400 INVALID_SUPPLIER_PERFORMANCE_FILTER`
(mesma política fail-fast da Avaliação Fornecedor).

## 2. Fontes e identidade (sem heurística)

| Conceito | Autoridade | Observação |
|---|---|---|
| Pedido | `NomusPurchaseOrder.id` / `externalId` | espelho read-only |
| Linha | `NomusPurchaseOrderItem` (`purchaseOrderId` + `lineIndex`) | chave determinística |
| Fornecedor | `NomusPurchaseOrder.supplierExternalId` (ID Nomus) | nome/documento só para exibição via `resolveNomusOrderSuppliersBatch`; **nunca agrupa por nome**; aliases contados por fornecedor distinto (várias linhas do mesmo fornecedor não são ambiguidade) |
| Material | `NomusPurchaseOrderItem.productExternalId` (`nomus:<id>`), fallback `productCode` (`code:<código>`) | **nunca por descrição**; sem ID/código = `UNRESOLVED` (contado, excluído das análises por MP) |
| Grupo de material | `NomusProductCatalog.groupName` via `externalProductId` | vínculo por ID |
| Data operacional | `COALESCE(issuedAt, firstSeenAt)` | `periodWhere` reutilizado de `nomusPurchaseOrderEvaluation.server.ts` |
| Valor do pedido | `NomusPurchaseOrder.totalAmount` | mesma autoridade do KPI "Valor aberto" de Pedidos Nomus |
| Valor da linha | `NomusPurchaseOrderItem.totalAmount` (`valorTotal` Nomus) | usado em toda análise por MP |
| Preço unitário | `NomusPurchaseOrderItem.unitPrice` (`valorUnitario`) | último preço |
| Quantidade | `orderedQuantity` / `receivedQuantity` + `unit` (texto oficial) | sem conversão |
| Cancelamento | `canceled === true OU stage === "CANCELED"` | predicado `canceledOnly` de Pedidos Nomus |
| Moeda | `NomusPurchaseOrder.currency`; ausente = BRL | convenção de Pedidos Nomus (`formatCurrency`); sem câmbio |
| Avaliação | `NomusPurchaseOrderSupplierEvaluation` + motor OP-26 | `resolveSupplierEvaluationAggregation`, `buildSupplierPerformanceSummary` |
| Status cadastral | `FinancialSupplier.status` via identidade EXACT/HIGH | parcial |

Dois fornecedores com nomes parecidos e IDs diferentes são dois fornecedores.
Duas MPs com a mesma descrição e IDs diferentes são duas MPs. Testado.

## 3. População e elegibilidade

| Etapa | Regra |
|---|---|
| Período | data operacional dentro de `[from, to]` (dia civil local, fim exclusivo) |
| Cancelados | **excluídos por padrão** com o predicado oficial; filtro "Incluir cancelados" traz a base inteira (mesma elegibilidade da Avaliação Fornecedor) |
| Moeda | moeda principal = mais pedidos; outras moedas **nunca são somadas**; filtro de moeda isola cada uma |
| Fornecedor | `supplierExternalId` |
| MP / grupo | linhas filtradas; pedido sem linha compatível sai; **base de spend muda para linha** (`spendBasis = "line"`) |

### BLOCKED_BY_BUSINESS_RULE — pedido válido para compra

O domínio atual não define "pedido válido para compra". A Avaliação Fornecedor
considera toda a base (inclusive cancelados); Pedidos Nomus só define o
predicado de cancelamento. A aba aplica, por padrão, **excluir cancelados** com
esse predicado, mostra a regra na tela (`metadata.eligibilityRule`) e a
quantidade excluída (`metadata.population.canceledExcluded`). A decisão final é
de negócio e está registrada como pendente — nada foi decidido em silêncio.

### Base de spend

- Sem filtro de MP/grupo: **cabeçalho** (`totalAmount`). Pedido sem valor não
  soma e é contado (`ordersWithoutValue`).
- Com filtro de MP/grupo: **linhas** (`SUM(totalAmount)` das linhas filtradas).
- Cabeçalho e linhas podem diferir (frete, desconto, linha sem valor). Ambos os
  totais são expostos em `metadata.population.headerSpendTotal / lineSpendTotal`.
  **Nenhum rateio** de frete/desconto entre linhas.

## 4. Filtros

| Filtro | Fonte | Status |
|---|---|---|
| Período (presets + ano + personalizado) | data operacional | disponível; default = últimos 12 meses (convenção da Avaliação Fornecedor) |
| Fornecedor | `supplierExternalId` (opções da base do período) | disponível |
| Matéria-prima | busca por código/descrição; identidade por ID | disponível |
| Grupo de material | `NomusProductCatalog.groupName` | disponível |
| Moeda | só quando a base é multimoeda | disponível |
| Incluir cancelados | predicado oficial | disponível |
| Empresa | `idEmpresa` existe só no `rawPayload`, sem cadastro vinculado | **UNAVAILABLE_SOURCE** (controle desabilitado com motivo) |
| Status de avaliação | — | não aplicável a métricas financeiras; rankings de avaliação já consideram só avaliados |

Todos os KPIs, rankings, gráficos, matriz e scorecard respeitam os mesmos
filtros. Exceção documentada: a nota do fornecedor é calculada sobre os pedidos
do período (mesma autoridade da Avaliação Fornecedor), portanto **também
respeita o período** — a UI rotula "Nota atual — pedidos do período selecionado".

## 5. Catálogo de métricas

Legenda de filtros: P = período, F = fornecedor, M = MP/grupo, C = moeda, X = cancelados.

| Indicador | Fórmula | Fonte | Status | Filtros | Observação |
|---|---|---|---|---|---|
| PURCHASE_SPEND | `SUM(spend canônico)` | cabeçalho / linhas | available | P F M C X | valor de pedidos emitidos (não recebido/pago) |
| ACTIVE_SUPPLIERS | `COUNT DISTINCT supplierExternalId` | NomusPurchaseOrder | available | P F M C X | pedidos sem ID não contam como fornecedor |
| PURCHASE_ORDER_COUNT | `COUNT DISTINCT id` | NomusPurchaseOrder | available | P F M C X | |
| PURCHASE_LINE_COUNT | `COUNT linhas` | NomusPurchaseOrderItem | available | P F M C X | |
| AVERAGE_ORDER_TICKET | spend ÷ pedidos | idem | available | P F M C X | null sem pedidos |
| MATERIAL_MIX_COUNT | `COUNT DISTINCT materialKey` | NomusPurchaseOrderItem | available | P F M C X | linhas sem identidade fora |
| AVERAGE_SUPPLIER_MIX | média do mix por fornecedor ativo | idem | available | P F M C X | |
| SUPPLIER_PURCHASE_SHARE | spend fornecedor ÷ total | idem | available | P F M C X | inclui bucket "não identificado" para fechar 100% |
| TOP1/TOP3/TOP5_CONCENTRATION | `SUM(spend top N) ÷ total` | idem | available | P F M C X | fornecedores identificados |
| SINGLE_SOURCE_OBSERVED_COUNT / RATE | MPs com 1 fornecedor observado (÷ total MPs) | idem | available | P F M C X | **observado ≠ homologado** |
| DUAL_SOURCE_OBSERVED_RATE | MPs com ≥ 2 fornecedores ÷ total MPs | idem | available | P F M C X | não afirma homologação alternativa |
| AVG_SUPPLIERS_PER_MATERIAL | média de fornecedores por MP com fornecedor identificado | idem | available | P F M C X | |
| SUPPLIER_EVALUATION_SCORE | AVG(overallScore) na escala vigente — motor OP-26 | NomusPurchaseOrderSupplierEvaluation | available (flag ON) | P F M C X | peso igual por pedido; V1/V2 nunca misturados |
| SUPPLIER_EVALUATION_COVERAGE | evaluated ÷ eligible (`buildSupplierPerformanceSummary`) | idem | available (flag ON) | P F M C X | toda a base é elegível (regra Nomus) |
| SUPPLIER_QUALITY/DELIVERY/COMPLIANCE/SERVICE_SCORE | AVG por critério (25% cada na nota do pedido) | idem | available (flag ON) | P F M C X | |
| SUPPLIER_MATERIAL_SPEND | `SUM(linha.totalAmount)` por fornecedor × MP | NomusPurchaseOrderItem | available | P F M C X | |
| SUPPLIER_MATERIAL_SHARE | spend fornecedor na MP ÷ spend da MP | idem | available | P F M C X | |
| WEIGHTED_AVERAGE_PRICE | `SUM(valor) ÷ SUM(quantidade)` por MP + fornecedor + unidade + moeda | idem | available | P F M C X | só linhas com valor e qtd > 0; nunca média simples de unitPrice |
| LAST_PURCHASE_PRICE | `unitPrice` da linha mais recente **com preço** (data, ID do pedido, índice) | idem | available | P F M C X | `lastPriceDate` pode ser anterior à última compra |
| PRICE_SPREAD | max − min preço médio; `÷ min` | preço médio | available | P F M C X | não é "saving potencial" |
| PRICE_INCREASES | preço médio do último mês − primeiro mês (MP + fornecedor + unidade) | preço médio | available | P F M C X | não é reajuste contratual |

### Disponibilidade dos indicadores avançados

| Indicador | Status | Fonte / motivo |
|---|---|---|
| OTD | **unavailable** | sem data efetiva de recebimento no espelho (NF-e/documento de entrada são evidência do 360, não autoridade de recebimento) |
| OTIF | **unavailable** | idem; quantidade recebida existe, data não |
| AVG_DELAY / MAX_DELAY | **unavailable** | idem |
| LEAD_TIME (real) | **unavailable** | idem |
| PROMISED_LEAD_TIME | available | média(expectedAt − data operacional) |
| EARLY_DELIVERIES | **unavailable** | idem |
| FILL_RATE | **partial** | média(receivedQuantity ÷ orderedQuantity) por linha; inclui pedidos abertos |
| PARTIALLY_RECEIVED_ORDERS | available | `stage = PARTIALLY_RECEIVED` |
| OPEN_OVERDUE_ORDERS | available | `isNomusPurchaseOrderOverdue` (mesma regra de Pedidos Nomus) |
| APPROVAL/REJECTION_RATE, PPM, NCR, NCR_RECURRENCE, COST_OF_POOR_QUALITY | **unavailable** | sem fonte oficial de inspeção/NC; nota "Qualidade" ≠ PPM |
| RETURNS | **unavailable** | status de item 7/8 só no rawPayload, sem valor/data |
| RESPONSE_TIME, RESOLUTION_TIME, CORRECTIVE_ACTION_RESPONSE, SCAR | **unavailable** | sem fonte de chamados/SCAR |
| SUPPLIER_HOMOLOGATION, CERTIFICATES, MATERIAL_CERTIFICATES, EXPIRED_DOCUMENTS, COMPLIANCE_STATUS | **unavailable** | sem cadastro de homologação/documentos |
| SUPPLIER_REGISTRY_STATUS | partial | `FinancialSupplier.status` só com identidade EXACT/HIGH |
| AVG_PAYMENT_TERM_DAYS | **unavailable** | condição é texto livre; sem vínculo PO → AP determinístico |
| PAYMENT_TERMS | partial | texto declarado no pedido |
| INCOTERM (CIF/FOB) | **unavailable** | `modalidadeTransporte` só no rawPayload |
| MOQ, PRICE_ADJUSTMENTS, SAVINGS, COST_AVOIDANCE | **unavailable** | sem fonte; savings SC não vinculado ao Pedido Nomus |
| PPV | **unavailable** | preço de referência oficial não identificado; `Material.standardCost` é do motor de custeio e sem vínculo Material ↔ produto Nomus |
| CONCENTRATION, SINGLE_SOURCE_OBSERVED, DUAL_SOURCE_OBSERVED, DEPENDENCY | available | calculados |
| CRITICALITY | **unavailable** | `Material.marketCriticality` sem vínculo ao produto Nomus |

Indisponível é renderizado como "Indicador indisponível — fonte operacional
ainda não identificada". **Nunca 0.** Zero é zero real.

## 6. Avaliação (preservada 100%)

- Metodologia V2 `SUPPLIER_ORDER_EVALUATION_V2`: quatro critérios 1–5, pesos
  25/25/25/25. V1 (0–10) permanece histórica.
- O dashboard **não** define pesos, escala ou score composto. Usa
  `resolveSupplierEvaluationAggregation` (V2 preferido; V1 só quando não há V2;
  nunca ambos), `averageScoreOrNull` e `buildSupplierPerformanceSummary`.
- Sem ponderação por valor ou quantidade. Cada pedido avaliado tem peso 1.
- V1 nunca é dividido por 2 nem convertido. Ranking "Melhores avaliados" só V2;
  "Avaliações legadas (V1)" é bloco separado na escala 0–10.
- Cobertura = `evaluatedOrders ÷ eligibleOrders`, com `eligibleOrders = 0 → null`
  ("Sem pedidos elegíveis no período").
- Flag `SUPPLY_CHAIN_SUPPLIER_PERFORMANCE_ENABLED` OFF: a seção de avaliação é
  marcada indisponível, nenhuma consulta de avaliação é feita e nenhum card
  mostra nota.

## 7. Single-source observado × fornecedor homologado único

"Fornecedor único observado" significa apenas que, no período e filtros
selecionados, aquela MP foi comprada de um único `supplierExternalId`. **Não**
prova que não existam outros fornecedores homologados, cotados ou cadastrados.
O rótulo, o tooltip e o registro de disponibilidade repetem essa ressalva.

## 8. Unidade e moeda

- Quantidade só é somada dentro da mesma MP **e** unidade. Par com unidades
  mistas mostra "N un. distintas" e não tem quantidade nem preço médio.
- Preço médio, último preço, dispersão e evolução são sempre por MP + fornecedor
  + unidade + moeda.
- Moedas diferentes nunca são somadas; sem câmbio. A UI avisa "Base multimoeda".

## 9. Performance (sem N+1)

Por requisição: 1 consulta de pedidos, 1 de linhas, 1 de avaliações (flag ON),
1 saúde do sync, 1 anos, 1 catálogo, batch fixo de identidade de fornecedor
(`resolveNomusOrderSuppliersBatch`), 1 status cadastral. Número constante —
provado em `supplierPerformanceDashboardService.test.ts` (0 × 250 fornecedores).
Toda agregação acontece no motor puro. Matriz paginada no servidor (máx. 200
por página); scorecard e detalhe de MP carregados sob demanda.

## 10. Estados de UI

LOADING · ERROR (com "Tentar novamente") · EMPTY ("Nenhuma compra encontrada…",
sem parecer erro; catálogo de indicadores continua visível) · PARTIAL (avisos
de multimoeda, avaliação desligada, pedidos/linhas não identificados) · SUCCESS.
Painel "Dados e regras (auditoria)" expõe geração, última sincronização,
população, exclusões, totais cabeçalho × linhas e autoridades.

## 11. Testes

```bash
npx tsx --test src/lib/purchasing/supplierPerformanceDashboard.test.ts \
  src/lib/purchasing/supplierPerformanceDashboardEvaluation.test.ts \
  src/lib/purchasing/supplierPerformanceDashboardService.test.ts \
  src/lib/purchasing/supplierPerformanceDashboardRoutes.test.ts \
  src/lib/purchasing/supplierPerformanceDashboardAccess.test.ts \
  src/components/purchases/performance/SupplierPerformanceDashboardUi.test.tsx
```

## 12. Fora desta versão (propostas, sem schema criado)

- Recebimento físico oficial com data e quantidade por linha → habilitaria OTD,
  OTIF, lead time real, atraso médio, fill rate completo. Candidato: documento
  de entrada de estoque Nomus vinculado ao pedido (hoje evidência do 360).
- Preço de referência oficial de compra → habilitaria PPV.
- Inspeção / não conformidade / devolução com valor → qualidade, PPM, NCR.
- Comparação com período anterior (não há helper canônico no módulo).
