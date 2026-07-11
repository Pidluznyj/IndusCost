# OrderToCashAudit — Schema da camada materializada

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Módulo** | Auditoria Pedido → Caixa / Conciliação de Carteira (aba futura) |
| **Tipo** | Documentação de schema (migration Prisma) |
| **Data** | 2026-07-11 |
| **Migration** | `20260722120000_order_to_cash_audit` |

---

## Objetivo

Criar uma **camada materializada de auditoria** que consolida evidências do caminho:

**Pedido de Venda → Documento de saída → NF → Contas a Receber → Pagamento/Baixa**

A camada serve para:

1. Auditoria operacional Pedido → Caixa.
2. Alimentar uma futura aba dentro da tela de **Conciliação de Carteira**.
3. Expor status, temperatura, alertas e lead times sem recalcular on-the-fly a cada request da UI.

---

## Tabelas criadas

### 1. `OrderToCashAuditRun`

Metadados de uma execução de materialização.

| Grupo | Campos |
|-------|--------|
| Identidade / ciclo | `id`, `startedAt`, `finishedAt`, `status`, `mode`, `createdBy`, `createdAt` |
| Escopo | `periodFrom`, `periodTo`, `year`, `dateAxis`, `customerFilter`, `sellerFilter`, `orderFilter` |
| Totais | `totalOrders`, `totalOrderItems`, `totalFacts`, valores monetários agregados |
| Diagnóstico | `warningsJson`, `errorMessage` |

**Status permitidos (String, sem enum rígido):** `RUNNING` · `SUCCESS` · `FAILED` · `PARTIAL`

**Mode:** `PREVIEW` · `APPLY` · `MANUAL` · `SCHEDULED`

### 2. `OrderToCashAuditFact`

Fato materializado por linha de auditoria (relação **1:N** com o run).

Blocos de campos:

| Bloco | Conteúdo |
|-------|----------|
| Identidade | `auditKey`, `lineType`, timestamps |
| Pedido | ids, código, status, valores, empresa |
| Cliente | ids, nome, documento, cidade/UF |
| **Vendedor** | ids, nome, fonte, qualidade (**nunca** “Representante”) |
| Condição de pagamento | termos planejados, parcelas, datas |
| Item do pedido | SKU, produto, quantidade, preço |
| Documento de saída | cabeçalho e vínculo NF |
| Item do documento | alocação, excesso, diferença de preço |
| NF | cabeçalho e item (quando disponível) |
| Contas a Receber | ids JSON, valores, status |
| Pagamento | datas, valores, atraso, status |
| Status consolidado | estágios, temperatura, confiança, ação |
| Alertas | flags booleanas + JSON |
| Datas / lead times | evidências e deltas em dias |

Relação: `OrderToCashAuditRun` **1:N** `OrderToCashAuditFact` (`onDelete: Cascade`).

Unique: `(runId, auditKey)` — idempotência por run.

---

## Grão da tabela de fatos

O grão oficial de `OrderToCashAuditFact` é a **linha de alocação / evidência**:

- tipicamente **item do pedido × documento/item de saída × (NF) × (CR/pagamento)**;
- linhas sem documento, com excesso ou produto fora do pedido também são fatos válidos (`lineType` distingue o tipo).

Não é um fato “só por pedido” nem “só por NF”: o pedido é a **âncora comercial**; o fato carrega o encadeamento completo disponível naquele run.

---

## Por que é uma tabela derivada

| Propriedade | Significado |
|-------------|-------------|
| **Derivada** | Calculada a partir de fontes oficiais já existentes (Pedido, Documento, NF, CR). |
| **Reconstruível** | Pode ser apagada e regenerada por um novo run sem perda de verdade oficial. |
| **Read-only na UI** | A tela futura **lê**; não escreve. |
| **Escrita restrita** | Somente a rotina de materialização grava nestas duas tabelas. |

Não há FK para `SalesOrder`, `NomusNfe`, `NomusStockDocument` etc.: apenas IDs snapshotados. Assim a migration **não altera** tabelas oficiais.

---

## Por que não substitui fontes oficiais

| Fonte oficial | Papel |
|---------------|--------|
| `SalesOrder` / `SalesOrderItem` | Verdade comercial do pedido |
| `NomusStockDocument` (+ items) | Verdade operacional de saída |
| `NomusNfe` | Verdade fiscal |
| Contas a Receber / Fluxo de Caixa | Verdade financeira e de caixa |

`OrderToCashAudit*` é **espelho analítico** para auditoria e UI de conciliação. Divergências entre o fato e a fonte oficial resolvem-se **na fonte** (ou no motor de materialização), nunca editando o fato como master.

**Fora do escopo desta camada:**

- Proposta (não é fonte oficial do funil Pedido → Caixa).
- Comissões.
- Conceito “Representante” (o negócio usa **Vendedor**).

---

## Índices criados

### Run

`status`, `mode`, `year`, `startedAt`, `(periodFrom, periodTo)`, `createdAt`

### Fact

`runId`, `(runId, auditKey)` unique, `salesOrderId`, `orderCode`, `externalSalesOrderId`, `externalCustomerId`, `customerName`, `externalSellerId`, `sellerName`, `externalProductId`, `productCode`, `sku`, `nfeExternalId`, `nfeNumber`, `stockDocumentId`, `receivableStatus`, `paymentStatus`, `orderToCashStage`, `operationalStage`, `financialStage`, `temperature`, `confidenceLabel`, `orderIssueDate`, `orderExpectedDeliveryDate`, `stockDocumentDate`, `nfeIssueDate`, `paymentDueDate`, `paymentSettlementDate`, `lineType`, `auditKey`

Índice `year` fica em **`OrderToCashAuditRun.year`** (campo de escopo do run).

---

## Tipos

| Tipo | Uso |
|------|-----|
| `Decimal(20,6)` | Valores monetários e quantidades |
| `Decimal(10,6)` / `(10,4)` | Percentuais / score |
| `DateTime` nullable | Datas que podem faltar na fonte |
| `Json` (JSONB) | Listas/termos/alertas estruturados |
| `Boolean` default `false` | Flags de alerta |
| `String` + índice | Status/estágios (flexível, sem enum Prisma) |

---

## Próximos passos

1. Aplicar a migration no ambiente de desenvolvimento (`prisma migrate deploy` / workflow interno) — **não** em produção neste prompt.
2. Implementar o **motor de materialização** (PREVIEW/APPLY) que grava apenas nestas tabelas.
3. Expor API read-only de leitura por `runId` / filtros (pedido, cliente, vendedor, estágio, temperatura).
4. Criar a aba na Conciliação de Carteira consumindo os fatos (UI sem escrita).
5. Scripts de auditoria/paridade: comparar totais do run com fontes oficiais sem mutá-las.

---

## Confirmações de escopo

- ✅ Apenas tabelas novas de auditoria.
- ✅ Nenhuma alteração em SalesOrder, SalesOrderItem, NomusNfe, NomusStockDocument(+Item), Contas a Receber, Fluxo de Caixa, Comissões, Relatório Presidencial, Precificação, Engenharia/BOM ou Suprimentos.
- ✅ Sem proposta, sem comissão, sem “Representante”.
- ✅ Camada derivada, reconstruível, read-only para UI.
