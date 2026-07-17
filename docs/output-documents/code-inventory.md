# DS-02.1 — Inventário técnico do código de Documentos de Saída

**Projeto:** IndusCost / My Industry  
**Data da auditoria:** 2026-07-16  
**Escopo:** somente código versionado, schema Prisma, migrations, scripts, services, repositories, rotas, componentes e testes locais  
**Fora do escopo:** consultas ao PostgreSQL de produção, chamadas ao Nomus, migrations, APIs, telas e alterações funcionais

> Este inventário descreve o que o repositório implementa hoje. Quantidade de
> registros, cobertura de campos, distribuição de tipos/status, vínculos órfãos
> e exemplos reais dependem de execução no ambiente do servidor e estão
> explicitamente marcados como **pendente de execução no servidor**.

## 1. Conclusões principais

1. **A representação local oficial já existe:** `NomusStockDocument` e
   `NomusStockDocumentItem` são o stage local de `documentosEstoque` do Nomus.
   Não existe model `OutputDocument`, `SalesDocument` ou `DocumentoSaida`.
2. **O sync é manual e isolado:** `scripts/nomusStockDocumentsSync.ts` lê
   `GET /rest/documentosEstoque`, faz preview/apply, upsert do cabeçalho por
   `externalId` e substituição integral dos itens. O daily sync não o executa.
3. **Documento → NF é uma ligação lógica, não FK:**
   `NomusStockDocument.idNfe` corresponde a `NomusNfe.externalId`.
4. **Documento → Pedido também não é FK:** o vínculo é derivado pela NF
   (`SalesOrderNfeLink.nfeExternalId`) e, no nível de item/valor, pelos facts
   reconstruíveis de `OrderToCashAuditFact`.
5. **Documento → CR é indireto:** `NomusAccountsReceivable.sourceInvoiceId`
   aponta para o ID externo da NF, não para o documento de estoque.
6. **A seção “Documentos de saída vinculados” não lê diretamente o stage como
   origem inicial.** Ela nasce dos `OrderToCashAuditFact` do pedido; depois o
   service enriquece os IDs encontrados em lote com `NomusStockDocument`,
   `NomusNfe` e `NomusAccountsReceivable`.
7. **O cabeçalho normalizado do documento é mínimo.** Cliente, empresa, status,
   cancelamento, número comercial, valor oficial de cabeçalho, condição de
   pagamento e parcelas não possuem colunas próprias no model atual.
8. **`OrderToCashAuditFact` é derivado e reconstruível.** Ele consolida
   Pedido × item × Documento × NF × CR, mas não deve ser promovido a master
   operacional ou financeiro.
9. **A verdade financeira continua sendo o CR oficial.** Valores de documento,
   NF, pedido e CR têm semânticas diferentes e não devem ser igualados ou
   somados como recebíveis independentes.
10. Criar uma segunda tabela master de “Documento de Saída” produziria alto
    risco de divergência com `NomusStockDocument`, com o rebuild O2C e com as
    regras já usadas no detalhe do Pedido e na Auditoria 360°.

## 2. Topologia atual

```text
Nomus GET /rest/documentosEstoque
  └─ scripts/nomusStockDocumentsSync.ts
       ├─ nomusStockDocumentsSyncLogic.ts (CLI, RSQL, paginação, plano)
       ├─ nomusStockDocumentsMapper.ts (normalização)
       └─ NomusStockDocument 1─N NomusStockDocumentItem

Nomus GET /rest/nfes
  └─ NomusNfe

Nomus GET /rest/pedidos
  ├─ SalesOrder 1─N SalesOrderItem
  └─ SalesOrderNfeLink

Nomus GET /rest/contasReceber
  └─ NomusAccountsReceivable

Relações lógicas:
  SalesOrderNfeLink.nfeExternalId
      = NomusNfe.externalId
      = NomusStockDocument.idNfe
      = NomusAccountsReceivable.sourceInvoiceId

scripts/rebuildOrderToCashAudit.ts
  └─ OrderToCashAuditRun 1─N OrderToCashAuditFact
       (camada derivada Pedido × item × Documento × NF × CR)

APIs atuais:
  GET /api/sales-orders/:salesOrderId/detail
      └─ getSalesOrderDetail → getOrderFullAudit

  GET /api/finance/portfolio-reconciliation/orders/:salesOrderId/audit-full
      └─ getOrderFullAudit

Telas:
  Detalhe do Pedido → “Documentos de saída vinculados”
  Auditoria 360° → aba “Documentos de Saída”
```

Não há FK entre `NomusStockDocument` e `NomusNfe`, `SalesOrder`,
`SalesOrderItem` ou `NomusAccountsReceivable`. A igualdade dos IDs externos e a
materialização O2C constituem a integração atual.

## 3. Models Prisma e migrations

### 3.1 `NomusStockDocument`

**Fonte:** `prisma/schema.prisma`  
**Migration de origem:** `20260710180000_nomus_stock_documents`

| Campo | Tipo | Papel atual |
|---|---|---|
| `id` | `String`, PK, UUID | Identidade local |
| `externalId` | `Int`, unique | ID do documento no Nomus; chave de upsert |
| `idNfe` | `Int?` | ID externo da NF; vínculo lógico com `NomusNfe.externalId` |
| `tipoDocumentoEstoque` | `String?` | Tipo bruto/normalizado; o sync usa `DocumentoSaida` por padrão |
| `dataDocumento` | `DateTime?` | Data normalizada por aliases do payload |
| `rawJson` | `Json` | Evidência integral do cabeçalho recebido |
| `syncedAt` | `DateTime` | Momento da última escrita do sync |
| `createdAt` | `DateTime` | Criação local |
| `updatedAt` | `DateTime` | Atualização local |
| `items` | `NomusStockDocumentItem[]` | Relação 1:N com itens |

**Índices/constraints:** unique em `externalId`; índices simples em `idNfe`,
`tipoDocumentoEstoque`, `dataDocumento` e `syncedAt`.

**Não existe no model:** FK para NF/Pedido/Cliente/Empresa; número comercial
separado do ID; status normalizado; `isCancelled`; data de cancelamento/estorno;
cliente; empresa; valor total oficial de cabeçalho; frete; desconto; impostos;
condição de pagamento; parcelas; vencimentos; hash do payload; primeira/última
presença no Nomus; flag de presença no último payload.

### 3.2 `NomusStockDocumentItem`

**Fonte:** `prisma/schema.prisma`  
**Migration de origem:** `20260710180000_nomus_stock_documents`

| Campo | Tipo | Papel atual |
|---|---|---|
| `id` | `String`, PK, UUID | Identidade local |
| `stockDocumentId` | `String`, FK | Pai `NomusStockDocument`; delete cascade |
| `externalItemId` | `Int?` | ID do item no payload Nomus |
| `externalProductId` | `Int?` | ID externo do produto usado no matching O2C |
| `quantity` | `Decimal(20,6)` | Quantidade normalizada |
| `unitValue` | `Decimal(20,6)` | Valor unitário normalizado |
| `estimatedTotalValue` | `Decimal(20,6)` | `quantity × unitValue`, calculado pelo mapper |
| `rawJson` | `Json` | Evidência integral do item recebido |
| `createdAt` / `updatedAt` | `DateTime` | Auditoria local |

**Índices/constraints:** FK com cascade; índices simples em `stockDocumentId`,
`externalProductId` e `externalItemId`.

**Ausências confirmadas:** não há unique
`(stockDocumentId, externalItemId)`; não há FK para `Product`,
`SalesOrderItem` ou NF item; não há descrição/SKU/unidade/CFOP/NCM/status em
colunas próprias; não existe quantidade/valor alocado a pedido no stage.

### 3.3 `NomusNfe`

**Fonte:** `prisma/schema.prisma`  
**Migration de origem:** `20260616120000_nomus_nfes`  
**Extensões fiscais posteriores:** migrations da família NF-e, incluindo
`20260726180000_nomus_nfe_fiscal_summary_lines`

Campos atuais:

- identidade: `id`, `externalId` (unique);
- identificação fiscal: `chave`, `numero`, `serie`;
- classificação/status: `status`, `tipoOperacao`, `tipoEmissao`,
  `finalidade`, `isFornecedor`, `ambiente`;
- emissor/autorização: `cnpjEmitente`, `protocolo`, `recibo`;
- datas: `dataProcessamento`, `horaProcessamento`, `xmlDhEmi`;
- XML/cancelamento: `xmlRaw`, `xmlCancelamento`,
  `justificativaCancelamento`;
- campos extraídos do XML: `xmlNatOp`, `xmlTpNF`, `xmlDestCnpjCpf`,
  `xmlVProd`, `xmlVDesc`, `xmlVNF`, `valorLiquido`;
- classificação de faturamento: `billingClassification`, `isFiscalBilling`,
  `isMarketSale`, `xmlQualityAlert`;
- sync: `rawPayload`, `payloadHash`, `syncedAt`, `createdAt`, `updatedAt`;
- relações fiscais: `fiscalSummary` e `taxLines`.

**Índices:** `dataProcessamento`, `xmlDhEmi`, `status`,
`billingClassification`, `isMarketSale`, `numero`, `xmlDestCnpjCpf`,
`syncedAt`, `payloadHash`; unique em `externalId`.

Para Documentos de Saída, `externalId` é a ponte lógica usada por
`NomusStockDocument.idNfe`. A NF possui status/cancelamento fiscal próprio;
isso não equivale a um status normalizado do Documento de Saída.

### 3.4 `NomusAccountsReceivable`

**Fonte:** `prisma/schema.prisma`  
**Migration de origem:** `20260606120000_nomus_accounts_receivable`

Campos atuais:

- identidade/classificação: `id`, `externalId` (unique), `classification`,
  `type`, `status`;
- empresa/pessoa: `companyId`, `companyName`, `personId`, `personName`,
  `personCnpj`, `personPhone`;
- conta/forma: `bankAccountId`, `bankAccountName`, `paymentMethodId`,
  `paymentMethodName`;
- datas: `dueDate`, `competenceDate`, `scheduleDate`, `createdAtNomus`,
  `modifiedAtNomus`, `settlementDate`;
- valores: `amountReceivable`, `amountScheduled`, `amountReceived`,
  `balanceReceivable`;
- conteúdo: `description`, `comments`;
- origem fiscal: `sourceInvoiceId`, `sourceInvoiceNumber`;
- cobrança: `suspendCollection`, `lateFeePercent`,
  `monthlyInterestRate`, `lateFeeCalculationType`, `lateInterestType`;
- sync: `rawPayload`, `payloadHash`, `syncedAt`, `createdAt`, `updatedAt`.

**Índices:** `dueDate`, `status`, `companyName`, `personName`, `personCnpj`,
`sourceInvoiceId`, `sourceInvoiceNumber`, `syncedAt`, `payloadHash`.

O CR não guarda `stockDocumentId`. O vínculo atual é
`sourceInvoiceId = NomusNfe.externalId`; consequentemente, Documento → CR passa
pela NF. Os valores e vencimentos deste model são a fonte financeira oficial,
não os totais dos itens do documento.

### 3.5 `SalesOrder`

**Fonte:** `prisma/schema.prisma`  
**Migration base:** `20260424120000_sales_orders_internal`, com extensões
posteriores do domínio de pedidos.

Campos atuais:

- identidade/origem: `id`, `proposalId` (unique), `sourceSystem`,
  `externalSalesOrderId`, `externalSalesOrderCode`, `orderCode` (unique);
- cliente/vendedor/empresa: `customerId`, `externalCustomerId`, `responsible`,
  `externalSellerId`, `nomusSellerName`, `companyIssuer`,
  `externalCompanyId`;
- status/datas: `status`, `issueDate`, `expectedDeliveryDate`,
  `sentToNomusAt`;
- condições: `paymentTerms`, `paymentMethod`, `freightCondition`,
  `deliveryLocation`, `notes`, `internalNotes`;
- totais: `totalItems`, `totalGrossValue`, `totalDiscount`, `totalNetValue`,
  `totalCost`, `totalMarginValue`, `totalMarginPerc`, `totalTaxes`,
  `totalFreight`;
- auditoria/raw: `createdAt`, `updatedAt`, `nomusRawResponse`;
- relações: `Customer`, `Proposal`, `items`, `CommercialActivity`,
  `nfeLinks`, vínculos de produção e snapshots de comissão.

**Índices/constraints:** unique em `proposalId` e `orderCode`; índices em
`customerId`, `status`, `issueDate`. Não há relação direta com
`NomusStockDocument`.

### 3.6 `SalesOrderItem`

**Fonte:** `prisma/schema.prisma`  
**Migration base:** `20260424120000_sales_orders_internal`; campos Nomus
adicionados principalmente em
`20260713140000_sales_order_item_nomus_status` e
`20260713150000_sales_order_item_nomus_line_match`.

Campos atuais:

- identidade/relações: `id`, `salesOrderId`, `proposalItemId`, `productId`;
- snapshot comercial: `externalProductId`, `skuSnapshot`,
  `productNameSnapshot`, `quantity`, `unit`, `unitCost`, `negotiatedPrice`,
  `totalNetValue`, `totalCost`, `marginValue`, `marginPerc`, `notes`;
- identidade/status Nomus: `nomusItemExternalId`, `nomusItemSequence`,
  `nomusItemStatusRaw`, `nomusItemStatusNormalized`,
  `nomusQuantityFulfilled`, `nomusQuantityPending`, `nomusIsCanceled`,
  `nomusIsStale`, `nomusIsCut`, `nomusMatchConfidence`,
  `nomusMatchReason`, `nomusLastSeenAt`, `nomusRawItem`;
- auditoria/relações: `createdAt`, `updatedAt`, `Product`, `ProposalItem`,
  `SalesOrder`, vínculos de produção e snapshots de comissão.

**Índices:** `salesOrderId`, `proposalItemId`, `productId`,
`nomusItemExternalId`, flags cancelado/stale/cut e `nomusMatchConfidence`.

O matching com itens de Documento de Saída é calculado no builder O2C; não há
FK persistida entre `SalesOrderItem` e `NomusStockDocumentItem`.

### 3.7 `SalesOrderNfeLink`

**Fonte:** `prisma/schema.prisma`  
**Migration de origem:** `20260626120000_sales_order_nfe_link`

Campos atuais:

- vínculo: `id`, `salesOrderId`, `nfeExternalId`, `nomusNfeId`;
- snapshots do pedido: `externalSalesOrderId`, `externalSalesOrderCode`,
  `orderCode`;
- snapshots da NF: `nfeNumber`, `nfeSerie`, `nfeKey`, `nfeStatus`,
  `tipoOperacao`, `tipoEmissao`, `dataProcessamento`, `horaProcessamento`,
  `cnpjEmitente`, `protocolo`, `recibo`, `usuario`, `ambiente`,
  `finalidade`, `isFornecedor`;
- evidência/presença: `rawPayload`, `presentInLastPayload`, `firstSeenAt`,
  `lastSeenAt`, `createdAt`, `updatedAt`;
- relação Prisma: somente `SalesOrder`.

**Constraints/índices:** unique `(salesOrderId, nfeExternalId)`; índices em
`salesOrderId`, `nfeExternalId`, `nfeNumber`, `nfeKey`,
`dataProcessamento`, `externalSalesOrderId`.

`nomusNfeId` é apenas `String?` no schema atual, sem `@relation`. O documento
de estoque alcança o pedido por igualdade de `idNfe/nfeExternalId` e pelo
rebuild O2C.

### 3.8 `OrderToCashAuditFact`

**Fonte:** `prisma/schema.prisma`  
**Migration de origem:** `20260722120000_order_to_cash_audit`

É uma materialização derivada associada a `OrderToCashAuditRun` por `runId`
com delete cascade. Os campos são agrupados por domínio:

- controle: `id`, `runId`, `auditKey`, `lineType`, `createdAt`, `updatedAt`;
- pedido: IDs/código/status/datas, totais, empresa;
- cliente: IDs/nome/documento/grupo/cidade/UF;
- vendedor: IDs/nome/fonte/qualidade;
- condição planejada: ID/nome/fonte, JSON de termos/datas, contagem,
  primeiro/último vencimento, valor e status;
- item do pedido: IDs/sequência/produto/SKU/descrição, quantidade, preço,
  total, entrega e status;
- Documento de Saída: IDs interno/externo, tipo, data, total, pessoa e
  `stockDocumentIdNfe`;
- item do documento: IDs/produto/quantidade/valor, flags de match, saldos de
  quantidade, excedente/fora, valores alocados por preço do pedido e do
  documento, diferenças de preço;
- NF: IDs/número/série/chave/status/operação/datas/valor de cabeçalho,
  método de vínculo, disponibilidade/origem de itens e dados do item;
- CR: IDs em JSON, contagem, total/aberto/recebido, vencimentos/baixas em
  JSON, status e fonte;
- pagamento: datas, esperado/recebido/aberto, atraso e status;
- classificação consolidada: estágios comercial, operacional, fiscal,
  financeiro, caixa e O2C; temperatura, confiança, responsável e ação;
- alertas: flags de atraso, falta/excesso, preço, vínculo, condição,
  vencimento e JSONs de alertas/bloqueios;
- lead times: últimas evidências e dias entre etapas.

**Constraints/índices:** unique `(runId, auditKey)`; índices em `runId`,
`salesOrderId`, códigos/IDs de pedido, cliente, vendedor e produto,
`nfeExternalId`, `nfeNumber`, `stockDocumentId`, status financeiro/pagamento,
estágios, temperatura/confiança, datas principais, `lineType` e `auditKey`.

O fact contém snapshots e cálculos que podem ficar defasados da origem até o
próximo rebuild. Ele não possui FK para Pedido, Documento, NF ou CR; somente
`runId` é relação Prisma.

## 4. Fluxo Nomus → sync → banco

### 4.1 Entrada e seleção

`scripts/nomusStockDocumentsSync.ts`:

1. carrega `.env` e exige `NOMUS_BASE_URL`;
2. aceita `preview` (default) ou `apply`;
3. exige período `--from/--to` ou uma lista `--idNfe`;
4. usa o resource `documentosEstoque`;
5. monta RSQL:
   - período:
     `dataEmissao>=dd/MM/yyyy;dataEmissao<=dd/MM/yyyy;tipoDocumentoEstoque==DocumentoSaida`;
   - pontual:
     `idNfe==N;tipoDocumentoEstoque==DocumentoSaida`;
6. pagina com `pagina` e `tamanhoPagina` (default 50);
7. reconhece arrays em várias chaves de resposta (`documentosEstoque`,
   `dados`, `data`, `results`, `items`, `content` e aliases aninhados);
8. redige URL/credenciais nos logs.

### 4.2 Mapper

`src/lib/nomusStockDocumentsMapper.ts`:

- cabeçalho:
  - `externalId`: `id` ou `idDocumentoEstoque`;
  - `idNfe`: `idNfe`;
  - tipo: `tipoDocumentoEstoque` ou `tipo`;
  - data: primeiro valor entre `data`, `dataDocumento`, `dataEmissao`,
    `dataMovimento`;
  - preserva todo o objeto em `rawJson`;
- itens:
  - arrays reconhecidos: `itensDocumentoEstoque`, `itens`, `items`,
    `itensDocumento` ou `documentoEstoque.itensDocumentoEstoque`;
  - quantidade: `qtde`, `quantidade` ou `qtd`;
  - valor unitário: `valorUnitario`, `precoUnitario` ou `vlUnitario`;
  - produto: `idProduto`, `produtoId` ou `produto.id`;
  - item sem quantidade ou valor unitário parseável é descartado;
  - `estimatedTotalValue` é calculado como quantidade × valor unitário com
    seis casas.

### 4.3 Persistência e preservação de itens (DS-03.2)

No começo de cada execução, os registros recebidos são deduplicados em memória
por `externalId` (a última ocorrência vence). Itens duplicados **dentro** do
mesmo payload também são colapsados (por `externalItemId` ou fingerprint
produto+qtde+valor; última ocorrência vence).

Em `apply`, cada documento roda em uma transação:

1. consulta por `externalId` (e conta itens existentes);
2. cria ou atualiza o cabeçalho;
3. grava `rawJson` e o mesmo `syncedAt` da execução;
4. decide a ação de itens via `decideStockDocumentItemsAction` /
   `planStockDocumentPersist` (lógica pura em `nomusStockDocumentsSyncLogic.ts`).

#### Regra final de substituição dos itens

| Classificação do payload | Como identificar | Ação nos itens |
|---|---|---|
| **Completo com itens** | chave de array reconhecida + ≥1 item mapeado | **replace** — `deleteMany` + `createMany` |
| **Completo sem itens** | chave de array reconhecida e `[]` | **replace** — limpa itens (documento comprovadamente vazio) |
| **Parcial (array ausente)** | nenhuma chave `itensDocumentoEstoque` / `itens` / `items` / … | **preserve** se já houver itens; senão **ignore** |
| **Parcial (não mapeável)** | array presente, mas nenhum item com qtde/valor válidos | **preserve** se já houver itens; senão **ignore** |
| **Inválido** | sem `id` / `idDocumentoEstoque` | **ignore** — documento não é persistido |

**Importante:** payload parcial **não** executa `deleteMany`. Itens já
sincronizados são preservados; o cabeçalho/`rawJson` ainda são atualizados.

O cabeçalho continua idempotente por `externalId`. Ainda **não** há
`payloadHash`/skip de unchanged (previsto em DS-03.4 + migration).

Contadores separados no resumo: documentos recebidos/criados/atualizados,
itens substituídos, itens preservados por payload parcial, payloads vazios,
payloads parciais, payloads inválidos, itens descartados pelo mapper,
duplicatas colapsadas e erros. `process.exitCode = 1` se `errors > 0` ou
`invalidPayloads > 0`.

O stage não altera AR, Pedido, NF, O2C, Comissões ou `InventoryMovement`.

### 4.4 Automação atual

- scripts npm:
  - `sync:nomus:stock-documents:preview`;
  - `sync:nomus:stock-documents:apply`;
- não há cron/job diário para Documentos de Saída;
- não há lock dedicado, cursor/checkpoint, `IntegrationRun`, hash ou política
  de “presente no último payload”;
- contagem atual, última execução real e cobertura de datas:
  **pendente de execução no servidor**.

## 5. Materialização Order-to-Cash

`scripts/rebuildOrderToCashAudit.ts` é um processo separado do sync de
documentos:

1. seleciona pedidos/itens no período;
2. carrega links Pedido→NF e as NFs relacionadas;
3. carrega `NomusStockDocument` com itens por `idNfe in nfeExternalIds`;
4. carrega CRs por `sourceInvoiceId` e, como fallback controlado, número da NF;
5. chama `buildOrderToCashAuditRows`;
6. em `apply`, cria um `OrderToCashAuditRun` e persiste facts em lotes.

O builder `src/lib/sales/orderToCashAuditBuilder.ts`:

- liga NF ao pedido usando `SalesOrderNfeLink`;
- agrupa documentos por `idNfe`;
- liga CRs às NFs;
- encontra candidatos de item por prioridade:
  `externalProductId` → `productId` → código/SKU normalizado;
- quando há múltiplos saldos do mesmo produto, aloca por FIFO de entrega,
  sequência e saldo;
- exclui itens do pedido cancelados/stale/zerados/cortados da alocação ativa;
- calcula quantidade utilizada/restante, excedente, produto fora do pedido,
  valor alocado pelo preço do pedido, valor alocado pelo preço do documento e
  diferença de preço;
- classifica estágios e alertas O2C.

`OrderToCashAuditFact` é evidência derivada de uma run. A fonte oficial de cada
domínio continua nos stages de Pedido, Documento, NF e CR.

## 6. Service e origem de “Documentos de saída vinculados”

### 6.1 Detalhe do Pedido

Fluxo:

```text
GET /api/sales-orders/:salesOrderId/detail
  → registerSalesOrderDetailRoutes
  → getSalesOrderDetail
  → getOrderFullAudit
  → mapStockDocuments
  → SalesOrderDetailView
```

Guardas: autenticação da aplicação e uma das permissões
`sales_orders.detail.view` / `sales_orders.view`. A resposta usa
`Cache-Control: no-store`.

`getOrderFullAudit`:

1. carrega os facts O2C do pedido (run indicada ou facts disponíveis);
2. monta `stockMap` a partir de `stockDocumentExternalId` presentes nos facts;
3. coleta os IDs de documento e de NF;
4. busca em lote `NomusStockDocument`/itens, `NomusNfe` e CRs;
5. enriquece cabeçalhos e itens;
6. compõe alertas, totais e vínculo com pedido/NF/CR.

Portanto, um `NomusStockDocument` existente no stage, mas ausente dos facts da
run O2C do pedido, pode não aparecer nessa seção. O `SalesOrderNfeLink` ajuda a
compor NFs, mas não substitui sozinho a materialização de documento/item.

### 6.2 Campos do DTO simplificado

`SalesOrderDetailStockDocument` expõe:

| Campo DTO | Origem real |
|---|---|
| `stockDocumentExternalId` | ID encontrado nos facts e enriquecido pelo stage |
| `numero` | `String(stockDocumentExternalId)`; não é campo comercial distinto |
| `dataDocumento` | fact e/ou `NomusStockDocument.dataDocumento` |
| `valorTotal` | total agregado de itens/facts; não há total oficial no cabeçalho stage |
| `allocatedValueToOrder` | soma O2C de `allocatedValueByDocumentPrice` |
| `hasExcess` | quantidades/alertas derivados pelo O2C |
| `hasOutside` | itens fora do pedido derivados pelo O2C |
| `idNfe` | `NomusStockDocument.idNfe` |

Na tela `SalesOrderDetailView`, a tabela mostra: Documento, Data, Valor doc.,
Alocado ao pedido, NF vinculada e Sinal. O “Sinal” é derivado:
`Excedente`, `Produto fora` ou `OK`; ele não representa o status bruto do
documento.

O mesmo componente é usado pelo fluxo atual de impressão/PDF do detalhe, logo
não existe uma segunda consulta específica de Documento de Saída para print.

### 6.3 Auditoria 360°

Rota:

`GET /api/finance/portfolio-reconciliation/orders/:salesOrderId/audit-full`

Service: o mesmo `getOrderFullAudit`.

O DTO rico `OrderFullAuditStockDocument` contém:

- ID externo, tipo, datas do documento/movimentação;
- cliente e empresa extraídos best-effort;
- `idNfe`;
- total, alocado e valor fora do pedido;
- quantidades do documento, usada, excedente e fora;
- flags `hasExcess` / `hasOutside`;
- quantidade de linhas;
- status best-effort;
- origem do vínculo (`ITEM_EVIDENCE`, `HEADER_ONLY`,
  `SALES_ORDER_NFE_LINK`, `UNKNOWN`);
- alertas.

`OrderFullAuditStockDocumentItem` acrescenta IDs/produto/SKU/nome/unidade,
quantidades, valor unitário/total, pedido/item associado, preço do pedido,
diferenças de preço, impacto financeiro, NF, CR, `lineType` e alertas.

A aba “Documentos de Saída” mostra cabeçalhos clicáveis e itens filtráveis. O
cabeçalho inclui ID, tipo, datas, cliente, empresa, NF, valores, status, origem
do vínculo e alertas. Cliente, empresa, data de movimentação e status podem ser
extraídos por aliases de `rawJson`; devem ser tratados como best-effort, não
como colunas oficiais do stage.

## 7. Rotas, services e artefatos relacionados

| Artefato | Responsabilidade atual |
|---|---|
| `scripts/nomusStockDocumentsSync.ts` | I/O Nomus e persistência manual do stage |
| `src/lib/nomusStockDocumentsMapper.ts` | Mapper puro de cabeçalho/itens |
| `src/lib/nomusStockDocumentsSyncLogic.ts` | CLI, query RSQL, paginação e plano |
| `scripts/rebuildOrderToCashAudit.ts` | Carregamento e materialização O2C |
| `src/lib/sales/orderToCashAuditBuilder.ts` | Matching/alocação/classificação pura |
| `src/lib/finance/orderFullAuditService.ts` | Composer Pedido/Documento/NF/CR |
| `src/lib/finance/orderFullAuditClient.ts` | Contrato rico da Auditoria 360° |
| `src/lib/salesOrderDetailRoutes.ts` | Rota oficial do detalhe do Pedido |
| `src/lib/sales-orders/salesOrderDetailService.server.ts` | Projeção simplificada do detalhe |
| `src/lib/sales-orders/salesOrderDetailClient.ts` | DTO frontend do detalhe |
| `src/components/sales/SalesOrderDetailView.tsx` | Tabela simplificada no Pedido/print |
| `src/lib/financePortfolioReconciliationRoutes.ts` | Rota `audit-full` |
| `src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx` | Aba rica da Auditoria 360° |

Não foi encontrada rota dedicada `/api/.../output-documents` nem página
Comercial → Documentos de saída no estado atual do código.

## 8. Campos disponíveis no código, mas não normalizados no schema do documento

O `rawJson` é preservado integralmente e o Audit 360 faz leituras best-effort
de aliases. O código atual procura, entre outros:

- cliente: `nomeCliente`, `cliente`, `razaoSocialCliente`, `customerName`;
- empresa: `empresa`, `razaoSocialEmpresa`, `companyName`;
- data de movimentação: `dataMovimentacao`, `dataMov`, `movementDate`;
- status: `status`, `situacao`, `statusDocumento`.

Esses campos estarem contemplados pelo leitor **não prova preenchimento,
estabilidade de nome ou cobertura no banco**. A validação do payload real e da
porcentagem de preenchimento está **pendente de execução no servidor**.

Campos confirmadamente disponíveis por outras fontes locais:

- número/série/chave/status/valores fiscais da NF em `NomusNfe`;
- cliente, empresa, condição e valores do pedido em `SalesOrder`;
- itens e preços do pedido em `SalesOrderItem`;
- total/aberto/recebido/vencimentos do CR em
  `NomusAccountsReceivable`;
- alocação e divergências em `OrderToCashAuditFact`.

Esses dados não devem ser copiados para um novo master de documento sem uma
necessidade de domínio e uma política explícita de precedência.

## 9. Lacunas confirmadas no schema atual

1. Cabeçalho de Documento de Saída sem cliente/empresa/status/cancelamento
   normalizados.
2. Sem número comercial separado de `externalId`.
3. Sem total oficial de cabeçalho; `estimatedTotalValue` é derivado dos itens.
4. Sem condição de pagamento, parcelas e vencimentos do documento.
5. Sem FK Documento→NF; ligação apenas por IDs externos.
6. Sem FK/tabela canônica Documento→Pedido ou item→item do pedido.
7. Sem ligação direta Documento→CR.
8. Sem hash/checkpoint/presença no último payload no stage do documento.
9. Sem unique composto para identidade do item dentro do documento.
10. Sem status de item normalizado.
11. Sem model `Company`; empresa aparece denormalizada em outros stages.
12. O2C possui muitos snapshots, mas é reconstruível e não substitui essas
    ausências no master do documento.

## 10. Dependências atuais do O2C

O O2C depende de todos os seguintes conjuntos estarem sincronizados e
coerentes:

- `SalesOrder` e itens ativos;
- `SalesOrderNfeLink`;
- `NomusNfe`;
- `NomusStockDocument` e itens;
- `NomusAccountsReceivable`;
- regras de matching/alocação do builder;
- uma run O2C materializada quando a tela consome facts.

Consequências:

- documento sem `idNfe` não percorre o caminho principal de associação;
- NF sem link com pedido reduz a capacidade de atribuição;
- documento sincronizado após a última run pode não aparecer no detalhe até
  rebuild;
- item sem quantidade/valor parseável é descartado pelo mapper e não chega ao
  matching;
- múltiplos pedidos/produtos repetidos exigem a alocação do builder; não é
  seguro atribuir o valor bruto integral do documento a cada pedido;
- facts antigos podem refletir um snapshot anterior dos stages;
- NF cancelada e CR possuem semânticas próprias; não se deve inferir
  cancelamento/pagamento apenas pelo documento.

## 11. Testes existentes

### Sync e mapper

`src/lib/nomusStockDocuments.test.ts` cobre:

- parsing de quantidade pt-BR (`"3.000"` → 3000);
- parsing de valor unitário (`"4,92"` → 4,92);
- cálculo de `estimatedTotalValue`;
- mapeamento de documento/itens e preservação de `rawJson`;
- classificação complete / empty / partial / unmapped / inválido;
- deduplicação de itens no mesmo payload;
- decisão `replace` | `preserve` | `ignore` (inclui preservação em parcial);
- segunda execução idempotente no plano completo;
- CLI preview/apply;
- query RSQL por período e `idNfe`;
- exit code com erros/payloads inválidos;
- garantia de que preview não escreve.

Limitações dos testes atuais:

- não validam contagens/cobertura do banco real;
- não provam que aliases de cliente/empresa/status existem em todos os
  payloads Nomus;
- a preservação parcial é coberta na lógica pura / plano; apply com Prisma
  real permanece a validar no servidor;
- não há teste de integração com PostgreSQL de produção (por definição);
- os casos reais e órfãos dependem de probe no servidor.

## 12. Riscos de uma segunda fonte de verdade

| Risco | Impacto |
|---|---|
| Criar `OutputDocument` paralelo | Dois masters para o mesmo objeto Nomus, com sync e status divergentes |
| Copiar CR para o documento | Duplica a verdade financeira e pode conflitar com baixas/estornos |
| Tratar fact O2C como master | Snapshot derivado pode estar defasado e é reconstruível |
| Persistir vínculo simplista Documento→Pedido | Ignora múltiplos pedidos, alocação parcial e itens fora/excedentes |
| Usar valor bruto do documento por pedido | Duplica cobertura e receita |
| Igualar valor do documento, NF, pedido e CR | Mistura preço operacional, valor fiscal e obrigação financeira |
| Inferir cancelamento pelo status da NF | NF e documento têm ciclos diferentes |
| Expor `rawJson` em listagem comum | Aumenta payload e risco de vazamento técnico |
| Duplicar lógica do Audit 360 em nova API | Resultados diferentes para os mesmos vínculos |
| Automatizar o sync atual sem hardening | Replace de itens pode propagar payload parcial |

Princípio de preservação: `NomusStockDocument` é o stage do documento;
`NomusNfe` é a fonte fiscal; `NomusAccountsReceivable` é a fonte financeira;
`SalesOrder` é a fonte comercial; `OrderToCashAuditFact` é conciliação
derivada. Uma nova leitura deve compor essas fontes, não substituí-las.

## 13. Informações pendentes de execução no servidor

Nenhuma contagem abaixo foi inferida do código. Permanecem pendentes:

- total de `NomusStockDocument` e `NomusStockDocumentItem`;
- quantidade por `tipoDocumentoEstoque`;
- período mínimo/máximo e última sincronização;
- percentual de documentos sem `idNfe`, sem data e sem itens;
- cobertura real dos aliases de cliente, empresa e status em `rawJson`;
- existência de número comercial distinto de `externalId`;
- presença e formato de condição/parcelas no payload;
- documentos com NF inexistente, NFs sem documento e links de pedido órfãos;
- cobertura da última run O2C versus o stage atual;
- documentos associados a múltiplos pedidos;
- documentos/NFs cancelados e impacto nas telas;
- reconciliação de valores Documento × Pedido × NF × CR;
- comportamento de casos reais específicos ainda não versionados em fixtures.

Essas verificações exigem execução read-only no servidor/banco e não fazem
parte da DS-02.1.

## 14. Arquivos de referência

- `prisma/schema.prisma`
- `prisma/migrations/20260710180000_nomus_stock_documents/migration.sql`
- `prisma/migrations/20260616120000_nomus_nfes/migration.sql`
- `prisma/migrations/20260606120000_nomus_accounts_receivable/migration.sql`
- `prisma/migrations/20260626120000_sales_order_nfe_link/migration.sql`
- `prisma/migrations/20260722120000_order_to_cash_audit/migration.sql`
- `scripts/nomusStockDocumentsSync.ts`
- `src/lib/nomusStockDocumentsMapper.ts`
- `src/lib/nomusStockDocumentsSyncLogic.ts`
- `scripts/rebuildOrderToCashAudit.ts`
- `src/lib/sales/orderToCashAuditBuilder.ts`
- `src/lib/finance/orderFullAuditService.ts`
- `src/lib/finance/orderFullAuditClient.ts`
- `src/lib/salesOrderDetailRoutes.ts`
- `src/lib/sales-orders/salesOrderDetailService.server.ts`
- `src/lib/sales-orders/salesOrderDetailClient.ts`
- `src/components/sales/SalesOrderDetailView.tsx`
- `src/lib/financePortfolioReconciliationRoutes.ts`
- `src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx`
- `src/lib/nomusStockDocuments.test.ts`
- `docs/output-documents/current-state-audit.md`

## 15. Confirmações de escopo

- Nenhuma migration foi criada.
- Nenhuma API, rota, tela, permission ou regra funcional foi alterada.
- Nenhum dado de produção foi consultado.
- Nenhuma contagem de banco foi inventada.
- O único artefato novo desta etapa é este inventário técnico.
