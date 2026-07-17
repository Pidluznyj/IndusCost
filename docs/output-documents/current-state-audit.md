# DS-01 — Auditoria da fonte oficial e completude dos Documentos de Saída

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Escopo** | Auditoria read-only antes da tela Comercial → Documentos de saída |
| **Data** | 2026-07-16 |
| **Commit esperado** | apenas este documento (sem migration, sem UI, sem alteração de regras) |
| **Banco local** | `induscost_validate@localhost:5432` — **indisponível** (`P1001`) nesta sessão |

---

## 1. Resumo executivo

O IndusCost **já possui** representação local de Documento de Saída:

- Model oficial de stage: **`NomusStockDocument`** + **`NomusStockDocumentItem`**
- Origem Nomus: `GET /rest/documentosEstoque` com filtro típico `tipoDocumentoEstoque==DocumentoSaida`
- Sync: script manual `scripts/nomusStockDocumentsSync.ts` (preview/apply), **sem cron**
- Consumo atual: detalhe do Pedido, Auditoria 360º e motor Order-to-Cash / Conciliação de Carteira

**Não existe** model `OutputDocument` / `SalesDocument` / `DocumentoSaida`.  
**Não existe** tela Comercial → Documentos de saída nem API `/api/commercial/output-documents*`.

### Diagnóstico em uma frase

Há stage suficiente para montar a futura tela de consulta, mas o cabeçalho está **mínimo**, muitos campos úteis ficam só no `rawJson`, o vínculo Documento ↔ Pedido **não é FK** (é derivado via NF e materialização O2C), e condições/parcelas do documento **não estão normalizadas** — o financeiro oficial continua em Contas a Receber via NF (`sourceInvoiceId`).

### Checklist How it works / YAGNI (obrigatório)

| # | Pergunta | Resposta evidenciada |
|---|---|---|
| 1 | Já existe tabela/model para Documento de Saída? | **Sim** — `NomusStockDocument` |
| 2 | Existe model de documento de estoque que já o representa? | **Sim** — o próprio `NomusStockDocument` (tipo `DocumentoSaida`) |
| 3 | Existe sync Nomus específico? | **Sim** — `nomusStockDocumentsSync` (manual) |
| 4 | Onde o detalhe do Pedido obtém nº/data/valor/alocado/NF/sinal? | Via `getSalesOrderDetail` → `getOrderFullAudit` → facts O2C + enrich de `NomusStockDocument` |
| 5 | Persistido ou montado dinamicamente? | **Híbrido**: stage + facts materializados; agregação/sinal no request |
| 6 | Tabela de vínculo Documento ↔ Pedido? | **Não** (sem FK). Vínculo indireto: Doc.`idNfe` → `SalesOrderNfeLink` / O2C |
| 7 | Vínculo por item do pedido? | **Derivado** (produto/FIFO no O2C), sem tabela canônica |
| 8 | Vínculo Documento ↔ NF-e? | **Sim, por convenção** — `NomusStockDocument.idNfe` = `NomusNfe.externalId` (sem FK) |
| 9 | Vínculo Documento ↔ CR? | **Indireto** — CR liga à NF (`sourceInvoiceId`), não ao documento |
| 10 | Condições de pagamento do Documento armazenadas? | **Não normalizadas** (podem existir só em `rawJson`) |
| 11 | Parcelas/vencimentos do Documento armazenados? | **Não** no stage do documento; parcelas oficiais estão no CR |
| 12 | CR referencia documento ou só NF? | **Só NF** (`sourceInvoiceId` / número) |
| 13 | Order-to-Cash já consolida? | **Sim** — `OrderToCashAuditFact` (camada derivada/reconstruível) |
| 14 | Reutilizar services/DTOs/índices? | **Sim** — Audit 360, funnel O2C, billing NF list, parsers Decimal/data |
| 15 | O que depende só de `rawJson`? | Cliente, empresa, status, dataMovimentação, condição/parcelas do doc, totais de cabeçalho oficiais |
| 16 | O que não está sendo sincronizado? | Cron automático; normalização de cabeçalho rico; vínculo canônico item↔pedido; parcelas do documento |
| 17 | Risco de segunda fonte de verdade? | **Alto** se criar `OutputDocument` paralelo ou promover facts O2C a master |

---

## 2. Fluxo atual

```text
Nomus GET /rest/documentosEstoque
  → scripts/nomusStockDocumentsSync.ts (manual preview|apply)
  → NomusStockDocument + NomusStockDocumentItem

Nomus GET /rest/nfes
  → NomusNfe (+ fiscal summary/tax lines)

Nomus GET /rest/pedidos
  → SalesOrder + SalesOrderItem + SalesOrderNfeLink

Nomus GET /rest/contasReceber
  → NomusAccountsReceivable (sourceInvoiceId → NF)

scripts/rebuildOrderToCashAudit.ts
  → OrderToCashAuditRun / OrderToCashAuditFact
     (Pedido × item × documento × NF × CR)

UI Pedido — “Documentos de saída vinculados”
  GET /api/sales-orders/:id/detail
    → getSalesOrderDetail()
    → getOrderFullAudit()
    → mapStockDocuments()
    → SalesOrderDetailView
```

### Origem exata dos campos exibidos hoje no detalhe do Pedido

| Campo UI | DTO | Montagem | Fonte persistida |
|---|---|---|---|
| Documento (número) | `numero` | `String(stockDocumentExternalId)` | `NomusStockDocument.externalId` via fact |
| Data | `dataDocumento` | fact date, enrich `NomusStockDocument.dataDocumento` | stage + fact |
| Valor do documento | `valorTotal` | soma `stockDocumentItemTotalValue` dos facts | itens/facts; **não** há total de cabeçalho no stage |
| Valor alocado ao pedido | `allocatedValueToOrder` | soma `allocatedValueByDocumentPrice` | `OrderToCashAuditFact` |
| NF vinculada | `idNfe` | enrich stage | `NomusStockDocument.idNfe` (ID externo, não número) |
| Sinal | derivado | `hasExcess` / `hasOutside` → Excedente / Produto fora / OK | facts; **não** usa status bruto do documento |

Arquivos-chave:

- `src/lib/sales-orders/salesOrderDetailService.server.ts` — `mapStockDocuments`
- `src/lib/finance/orderFullAuditService.ts` — agregação e enrich
- `src/components/sales/SalesOrderDetailView.tsx` — tabela
- `src/lib/sales/orderToCashAuditBuilder.ts` — matching produto/FIFO
- `scripts/nomusStockDocumentsSync.ts` — persistência

---

## 3. Schema encontrado

### 3.1 Models relevantes

#### `NomusStockDocument` (stage oficial do Documento de Saída)

| Aspecto | Valor |
|---|---|
| Finalidade | Stage Nomus `documentosEstoque` para conciliação Pedido × NF × saída |
| PK | `id` (text uuid) |
| ID Nomus | `externalId` Int `@unique` |
| Campos | `idNfe?`, `tipoDocumentoEstoque?`, `dataDocumento?`, `documentNumber?`, `statusRaw?`, `isCancelled`, `cancelledAt?`, `cancellationReason?`, `totalValue?`, `personExternalId?`, `personName?`, `companyExternalId?`, `companyName?`, `movementDate?`, `paymentTermsRaw?`, `rawJson`, `payloadHash`, `firstSeenAt`, `lastSeenAt`, `presentInLastPayload`, `syncedAt`, `createdAt`, `updatedAt` |
| Relações | `items` → `NomusStockDocumentItem[]` |
| Índices | `idNfe`, `tipoDocumentoEstoque`, `dataDocumento`, `syncedAt`, `documentNumber`, `isCancelled`, `personExternalId`, `companyExternalId`, `movementDate`, `payloadHash`, `presentInLastPayload`, `lastSeenAt` |
| Origem | migrations `20260710180000_nomus_stock_documents` + `20260731120000_nomus_stock_document_header_enrichment` |
| Sync | `scripts/nomusStockDocumentsSync.ts` |
| Cobertura DB | **não medida nesta sessão** (P1001) |

#### `NomusStockDocumentItem`

| Aspecto | Valor |
|---|---|
| Finalidade | Linhas do documento |
| PK | `id` |
| Campos | `externalItemId?`, `externalProductId?`, `quantity`, `unitValue`, `estimatedTotalValue`, `rawJson` |
| FK | `stockDocumentId` → documento (cascade) |
| Índices | `stockDocumentId`, `externalProductId`, `externalItemId` |
| Lacuna | sem unique `(stockDocumentId, externalItemId)`; sem FK para `Product`/`SalesOrderItem` |

#### `NomusNfe` / `NomusNfeFiscalSummary` / `NomusNfeTaxLine`

Fonte fiscal oficial. Ligação ao documento por `externalId` ↔ `NomusStockDocument.idNfe`.  
CR liga por `NomusAccountsReceivable.sourceInvoiceId`.  
Não há model de itens comerciais da NF (apenas tax lines).

#### `SalesOrder` / `SalesOrderItem` / `SalesOrderNfeLink`

Pedido canônico + vínculo pedido↔NF. Não há FK pedido↔documento.

#### `NomusAccountsReceivable`

Títulos oficiais. Referência à **NF**, não ao Documento de Saída.

#### `OrderToCashAuditRun` / `OrderToCashAuditFact`

Camada **derivada** Pedido → Documento → NF → CR. Reconstruível. Não é master.

#### `PortfolioReconciliationRun` / `Fact`

Camada paralela de conciliação. Também não é fonte oficial financeira.

#### `Customer` / `Product` / `CommissionPerson`

| Model | Papel para Documentos de Saída |
|---|---|
| `Customer` | Cliente do pedido; sem Nomus ID no master |
| `Product` | Match de item do documento via `externalProductId` / SKU |
| `CommissionPerson` | Vendedor canônico; não é master do documento |
| **Company** | **Não existe model** — apenas denormalizações (`companyIssuer`, `companyName` em stages) |

### 3.2 Topologia real de vínculos

```text
SalesOrder
  └─(FK)─ SalesOrderNfeLink.nfeExternalId
            ≡ NomusNfe.externalId
            ≡ NomusStockDocument.idNfe
                 └─(FK)─ NomusStockDocumentItem
                      ≈ match produto → SalesOrderItem (O2C / allocation)
NomusAccountsReceivable.sourceInvoiceId ≡ NomusNfe.externalId
```

---

## 4. Scripts e serviços encontrados

| Artefato | Papel | Observação |
|---|---|---|
| `scripts/nomusStockDocumentsSync.ts` | Sync manual documentosEstoque | upsert header + replace itens; sem cron/lock/IntegrationRun/hash |
| `src/lib/nomusStockDocumentsMapper.ts` | Mapper | descarta item sem qtde/unitário |
| `src/lib/nomusStockDocumentsSyncLogic.ts` | CLI/query/paginação | default tipo `DocumentoSaida`; filtro `dataEmissao` |
| `scripts/probe-nomus-stock-documents.ts` | Probe read-only | âncora histórica PD 02339 / docs 7951,8175,8422 |
| `scripts/nomusNfesSync.ts` | Sync NF-e | hash + cancelamento status 7; cron dedicado documentado |
| `scripts/nomusAccountsReceivableSync.ts` | Sync CR | upsert por hash; liga à NF |
| `scripts/nomusSalesOrdersSyncV1.ts` | Sync pedidos + NF links | itens stale/cancel; paymentTerms textual |
| `scripts/rebuildOrderToCashAudit.ts` | Materializa O2C | lê stages locais |
| `scripts/rebuildPortfolioReconciliationFacts.ts` | Materializa portfolio | paralelo |
| `src/lib/sales/orderToCashAuditBuilder.ts` | Matching/alocação | produto → FIFO; rejeita ambíguo |
| `src/lib/finance/orderFullAuditService.ts` | Auditoria 360º | composer usado pelo detalhe |
| `src/lib/sales-orders/salesOrderDetailService.server.ts` | Detalhe Pedido | projeta `stockDocuments` |
| `src/lib/finance/salesOrderPlannedReceivables.ts` | Precedência financeira | CR > documento válido > previsão pedido |
| `src/lib/nomusDailySyncRunner.ts` | Daily sync | **não** inclui stock documents |
| Locks | NF-e/AR/sales/daily | stock documents **sem lock dedicado** |

### Riscos do sync de documentos

1. Replace total de itens: payload incompleto / sem array reconhecido pode apagar itens locais.
2. Sem `payloadHash` → regrava sempre.
3. Sem checkpoint/cursor/IntegrationRun.
4. Sem política de cancelamento/stale no cabeçalho.
5. Erros por documento podem deixar exit code 0.

---

## 5. Origem de cada campo (visão consolidada)

| Informação | Fonte recomendada | Situação atual |
|---|---|---|
| Número / ID documento | `NomusStockDocument.externalId` | Usado como “número” na UI; pode não ser o nº comercial Nomus |
| Data | `dataDocumento` (+ raw `dataMovimentacao`) | Parcial |
| Empresa / cliente | rawJson / pedido / NF | Não normalizado no stage |
| Tipo | `tipoDocumentoEstoque` | Normalizado |
| Status / cancelamento | rawJson | Não normalizado |
| Valor total | soma itens / raw | Sem coluna de cabeçalho |
| Itens qtde/unitário/total | `NomusStockDocumentItem` | Normalizado (`estimatedTotalValue` calculado) |
| Pedidos vinculados | O2C + `SalesOrderNfeLink` via `idNfe` | Derivado |
| Alocação por pedido/item | `OrderToCashAuditFact` | Derivado/reconstruível |
| NF | `idNfe` → `NomusNfe` | Convenção sem FK |
| CR / aberto / recebido | `NomusAccountsReceivable` via NF | Oficial |
| Condição / parcelas documento | rawJson (se existir) | Não confiável ainda |
| Previsão pedido | `SalesOrder` + `nomusRawResponse` | Fallback financeiro |
| Vendedor | pedido / CRM / comissão | Não é atributo do documento |
| Auditoria sync | `syncedAt`/`createdAt`/`updatedAt` | Parcial (sem firstSeen/lastSeen/hash) |

---

## 6. Quantidade e cobertura dos registros

### Ambiente desta sessão

| Checagem | Resultado |
|---|---|
| `npx prisma migrate status` | **Falha P1001** — PostgreSQL `localhost:5432` inacessível |
| Contagens `NomusStockDocument` / itens / nulos | **Não medidas** |
| Exemplos 8451 / PD 02590 / NF-e 7208 | **Não encontrados** em fixtures/docs versionados; **não consultáveis** sem DB |

### Evidência histórica versionada (não substitui contagem atual)

Caso âncora PD 02339 (Britânia), documentado em `docs/finance/nomus-portfolio-reconciliation-inventory.md`:

| idNfe | Doc estoque | Data | Total estimado itens |
|---|---|---|---|
| 6937 | 7951 | 13/05/2026 | R$ 108.240,00 |
| 7188 | 8175 | 08/06/2026 | R$ 168.075,00 |
| 7377 | 8422 | 26/06/2026 | R$ 78.975,00 |

**Pendência obrigatória de ambiente:** repetir DS-01 data probe quando o banco estiver online:

```bash
# Contagens e nulos
# Exemplos: externalId=8451, orderCode~02590, NomusNfe.numero/externalId=7208
```

---

## 7. Matriz de completude

Legenda cobertura: **Alta** / **Média** / **Baixa** / **N/A** / **Não medida**  
Confiabilidade: **Oficial** / **Derivada** / **Best-effort** / **Ausente**

| Informação | Existe localmente? | Model/tabela | Campo | Cobertura | Fonte | Confiabilidade | Grid? | Detalhe? | Ação necessária |
|---|---|---|---|---|---|---|---|---|---|
| número / ID | Sim | NomusStockDocument | externalId | Não medida | sync documentosEstoque | Oficial (ID) | Sim | Sim | Confirmar se existe nº comercial distinto no raw |
| ID Nomus | Sim | NomusStockDocument | externalId | Não medida | sync | Oficial | Sim | Sim | — |
| data emissão | Parcial | NomusStockDocument | dataDocumento | Não medida | mapper data/dataDocumento/dataEmissao/dataMovimento | Oficial se preenchida | Sim | Sim | Separar emissão × movimento se raw confirmar |
| data processamento | Parcial | NomusNfe / raw | dataProcessamento / raw | Baixa no doc | NF ou raw | Oficial na NF | Não (doc) | Sim (via NF) | Exibir na seção NF |
| empresa | Parcial | raw / SalesOrder / AR | company* | Baixa | rawJson best-effort | Best-effort | Sim* | Sim | Extrair/normalizar do raw se estável |
| cliente | Parcial | raw / SalesOrder / NF | person/customer | Baixa no doc | raw + pedido | Best-effort no doc; oficial no pedido | Sim* | Sim | Preferir cliente do pedido/NF quando resolvido |
| tipo | Sim | NomusStockDocument | tipoDocumentoEstoque | Não medida | sync | Oficial | Sim | Sim | Filtrar DocumentoSaida no grid |
| status | Parcial | rawJson | status/situacao | Baixa | raw | Best-effort | Sim* | Sim | Normalizar só com contrato Nomus confirmado |
| cancelamento | Não normalizado | — / NomusNfe | status NF=7; raw doc | Baixa | NF / raw | Oficial na NF | Sim (via NF) | Sim | Não inventar cancelamento por ausência |
| valor total | Parcial | soma itens / raw | estimatedTotalValue | Média | itens | Derivada | Sim | Sim | Não assumir = NF/CR/pedido |
| valor produtos | Parcial | itens / NF | estimated / xmlVProd | Média | itens/NF | Oficial NF; derivada doc | Não | Sim | Separar conceitos |
| tributos | Sim (NF) | NomusNfeFiscalSummary / TaxLine | v* | Alta na NF | XML NF | Oficial fiscal | Não | Sim (NF) | Não recalcular no doc |
| itens | Sim | NomusStockDocumentItem | * | Não medida | sync | Oficial operacional | Resumo | Sim | — |
| quantidade | Sim | NomusStockDocumentItem | quantity | Não medida | sync | Oficial | Não | Sim | — |
| valor unitário | Sim | NomusStockDocumentItem | unitValue | Não medida | sync | Oficial | Não | Sim | — |
| pedidos vinculados | Derivado | O2C / NfeLink | stockDocumentExternalId / idNfe | Depende da run | rebuild O2C | Derivada | Sim | Sim | Grid: exigir O2C ou join idNfe |
| itens dos pedidos | Derivado | OrderToCashAuditFact | salesOrderItemId… | Depende da run | O2C | Derivada | Não | Sim | — |
| valor alocado por pedido | Derivado | OrderToCashAuditFact | allocatedValueByDocumentPrice | Depende da run | O2C | Derivada | Sim | Sim | Dedup por documento |
| NF vinculada | Sim | NomusStockDocument | idNfe | Não medida | sync | Oficial se preenchida | Sim | Sim | Join NomusNfe para número/chave |
| chave da NF | Sim | NomusNfe | chave | Não medida | sync NF | Oficial | Não | Sim | — |
| condição pagamento (doc) | Não normalizada | rawJson? | ? | Ausente/baixa | raw | Ausente | Não | Só se evidência | Não inventar |
| parcelas (doc) | Não | — | — | Ausente | — | Ausente | Não | Não | Usar CR |
| vencimentos | Sim (CR) / parcial planejado | NomusAccountsReceivable / pedido | dueDate | Alta no CR | CR | Oficial CR | Cards | Sim | Precedência CR |
| Contas a Receber | Sim | NomusAccountsReceivable | * | Não medida | sync AR | Oficial | Cards/filtro | Sim | via NF |
| valor aberto | Sim | NomusAccountsReceivable | balanceReceivable | Não medida | sync AR | Oficial | Cards | Sim | — |
| valor recebido | Sim | NomusAccountsReceivable | amountReceived | Não medida | sync AR | Oficial | Cards | Sim | — |
| vendedor do pedido | Sim | SalesOrder / CRM / comissão | nomusSellerName… | Média | pedido | Oficial no pedido | Opcional | Sim (via pedidos) | Não atribuir ao doc sem evidência |
| rawJson | Sim | NomusStockDocument(+Item) | rawJson | Alta | sync | Evidência técnica | Não | Accordion gated | Nunca na listagem |
| primeira sincronização | Parcial | NomusStockDocument | createdAt | Não medida | DB | Proxy | Não | Sim | Adicionar firstSeenAt se necessário |
| última sincronização | Sim | NomusStockDocument | syncedAt | Não medida | sync | Oficial stage | Sim | Sim | — |

\*Grid só após normalização segura ou projeção explícita “best-effort”.

---

## 8. Análise dos exemplos reais

### 8.1 Solicitados neste prompt

| Exemplo | Resultado nesta sessão |
|---|---|
| Documento de Saída **8451** | Não localizado em fixtures/docs; DB offline |
| Pedido **PD 02590** | Não localizado em fixtures/docs; DB offline |
| NF-e **7208** | Não localizado em fixtures/docs; DB offline |
| Vínculos CR | Não mensuráveis aqui |

**Não foram inventados valores.** Classificação de diferenças documento × pedido × NF × CR fica pendente do probe com DB.

### 8.2 Âncora histórica disponível (PD 02339)

Usar apenas como referência de comportamento já documentado:

- Pedido R$ 158.000 com múltiplas NFs/documentos.
- Documento 7951 ↔ NF 6937: totais de itens batem com cabeçalho NF (R$ 108.240), mas preços unitários do documento (4,92) divergem do pedido (~5,85) — diferença legítima de preço/alocação.
- NF/documento podem cobrir **mais de um pedido** ou produtos fora do pedido.
- Alocação parcial e múltiplos pedidos são cenários reais do motor O2C.

### 8.3 Diferenças legítimas a preservar na futura UI

Não assumir igualdade entre Documento, Pedido, NF e CR. Classificar divergências como:

- tributos / encargos do vNF  
- frete / despesas / descontos / acréscimos  
- rateios e alocação parcial  
- múltiplos pedidos na mesma NF/documento  
- arredondamentos  
- produto fora do pedido / excedente  

---

## 9. Lacunas encontradas

1. Stage de cabeçalho pobre (sem cliente/empresa/status/total/condição normalizados).
2. Sem tabela canônica DocumentoItem ↔ SalesOrderItem.
3. Detalhe do Pedido depende de facts O2C — documento stage pode existir e sumir da UI se não houver run.
4. UI chama `externalId` de “Documento” e mostra `idNfe` em vez do número da NF.
5. Sinal do detalhe mascara status real / cancelamento.
6. Sync stock sem cron, lock, hash, IntegrationRun, política soft de ausência.
7. Replace de itens inseguro ante payload incompleto.
8. Condição/parcelas do Documento não modeladas; CR é a verdade financeira.
9. Sem model Company; Customer sem Nomus ID.
10. Contagens e casos 8451/02590/7208 não auditados por DB offline.
11. Risco de segunda fonte se criar `OutputDocument` paralelo ou tratar O2C como master.
12. Gap de segurança a não repetir: `includeRaw` do audit-full documenta `audit.raw.read` mas não enforceia no serviço.

---

## 10. Riscos

| Risco | Severidade | Mitigação |
|---|---|---|
| Segunda fonte de verdade (`OutputDocument` novo) | Alta | Reutilizar `NomusStockDocument` |
| Promover O2C/Portfolio a master financeiro | Alta | Manter derivados reconstruíveis |
| UI igualar valor doc = NF = CR = pedido | Alta | Separar cards e alertas |
| Listar rawJson na API grid | Alta | omitir; raw só com permissão técnica |
| N+1 / payload pesado | Média | select escalar; batch joins; pageSize clamp |
| Sync apply apagar itens | Alta | só replace com payload completo |
| Grid sem O2C mostrar zero pedidos | Média | join por `idNfe` + badge “sem materialização” |
| Condição do documento inventada | Alta | CR > condição doc > previsão pedido |

---

## 11. Fonte oficial recomendada

Aplicar obrigatoriamente: **CR real > condição do Documento de Saída > previsão do Pedido**.

| Grupo | Fonte oficial | Observação |
|---|---|---|
| 1. Cabeçalho do Documento | `NomusStockDocument` (+ campos normalizados futuros do raw) | Não criar nova tabela master |
| 2. Itens | `NomusStockDocumentItem` | `estimatedTotalValue` é q×p local |
| 3. Alocação aos pedidos | `OrderToCashAuditFact` (leitura) + futuro link canônico se necessário | Não editar pedido |
| 4. NF-e | `NomusNfe` (+ fiscal summary) via `idNfe` | Cancelada auditável, fora de totais válidos |
| 5. Condições de pagamento | 1º CR; 2º raw/condição do documento **somente se evidenciada**; 3º previsão do pedido | Sem segunda regra financeira |
| 6. Contas a Receber | `NomusAccountsReceivable` via `sourceInvoiceId` | Dedup por `externalId` |
| 7. Status financeiro | Saldos/recebido/vencimento do CR | Nunca pedido − NF |
| 8. Auditoria | `syncedAt`/`createdAt`/`updatedAt` + run O2C + raw gated | raw não é visão executiva |

---

## 12. Arquitetura proposta (sem migration nesta etapa)

### Reutilizar

- `NomusStockDocument` / `Item`
- `NomusNfe` + links + CR
- `getOrderFullAudit` / O2C builder (detalhe rico)
- Padrões: `salesOrderToCashFunnel*` (list/summary/detail), `financeBillingNfeList` (select/paginação/Decimal)
- `requireResource` + contrato de permissões

### Estender (futuro, estritamente necessário)

Campos de cabeçalho **somente** após confirmar presença estável no payload Nomus, por exemplo:

- `customerName` / `externalCustomerId`
- `companyName` / `externalCompanyId`
- `status` / `isCancelled`
- `documentNumber` (se distinto de `externalId`)
- `totalValue` oficial (se existir no payload; senão manter soma de itens com label claro)
- `payloadHash`, `firstSeenAt`, `lastSeenAt`, `presentInLastPayload`

### Nova tabela (só se indispensável)

`NomusStockDocumentSalesAllocation` (nome TBD):

- `stockDocumentItemId`, `salesOrderItemId`
- quantidade/valor alocados, método, confiança, runId, `isCurrent`
- **Não** substitui CR/NF/pedido

### Não fazer

- Criar `OutputDocument` paralelo
- Alterar regras de Pedido, NF-e, CR, AP, Fluxo, Comissões, Margem, Precificação, BOM, Estoque
- Expor raw na listagem
- Cron de stock sem proteção de replace incompleto

### Índices futuros sugeridos

- `(idNfe, tipoDocumentoEstoque, dataDocumento)`
- `(stockDocumentId, externalItemId)` (+ unique se Nomus garantir)
- `(stockDocumentId, externalProductId)`
- (opcional) `SalesOrder.externalSalesOrderId` unique/index — já gap do sync de pedidos

---

## 13. APIs propostas (contratos conceituais)

Permissão proposta (ainda **não cadastrar** nesta etapa):

- Canônica: `commercial.output_documents` (view, export)
- Parent: `commercial`
- Alias legado de transição (avaliar): `sales_orders.view` **não** deve ser o único grant permanente
- Raw técnico: exigir `audit.raw.read` (enforce server-side)

### `GET /api/commercial/output-documents`

Query: `page`, `pageSize` (default 50, max 200), `search`, `from`, `to`, `company`, `customer`, `status`, `tipo`, `orderCode`, `nfe`, `hasReceivable`, `format=csv?`

Resposta:

```json
{
  "filters": {},
  "pagination": { "page": 1, "pageSize": 50, "totalItems": 0, "totalPages": 0 },
  "items": [
    {
      "id": "...",
      "externalId": 8451,
      "tipoDocumentoEstoque": "DocumentoSaida",
      "dataDocumento": "2026-...",
      "idNfe": 7208,
      "nfeNumber": "...",
      "customerName": null,
      "companyName": null,
      "status": null,
      "totalValue": 0,
      "allocatedOrdersCount": 0,
      "receivableOpenValue": null,
      "syncedAt": "..."
    }
  ],
  "generatedAt": "..."
}
```

Sem `rawJson`. Decimal→number; datas ISO.

### `GET /api/commercial/output-documents/summary`

Mesmos filtros; cards: total documentos, valor itens, com/sem NF, com/sem pedido resolvido, CR aberto/recebido (via NF), cancelados (NF/doc).

### `GET /api/commercial/output-documents/:id`

Blocos:

1. **geral** — cabeçalho stage (+ best-effort raw whitelisted)
2. **itens** — `NomusStockDocumentItem`
3. **pedidos** — alocações O2C / joins por NF (códigos, valores alocados)
4. **NF-es** — `NomusNfe` (+ status oficial)
5. **financeiro** — CR por NF; condição doc só se evidenciada; previsão pedido só residual
6. **auditoria** — sync timestamps, run O2C, alertas; raw opcional gated

---

## 14. Estratégia de sincronização

1. Manter stage atual como fonte operacional do documento.
2. Endurecer apply: replace de itens **somente** com array explícito + métricas brutos×mapeados.
3. Adicionar `payloadHash` + `unchanged`.
4. Soft-presence (`lastSeenAt` / `presentInLastPayload`) — não apagar evidência.
5. Lock dedicado + `IntegrationRun` (padrão NF-e/AR).
6. **Não** entrar no daily sync até (2–5) estarem prontos.

---

## 15. Estratégia de backfill

1. Preview por janelas (`--from/--to`, `--tipo=DocumentoSaida`).
2. Apply com overlap de datas.
3. Reconciliação: contagem API×local, docs sem itens, `idNfe` órfão, NF link sem doc, itens descartados no mapper.
4. Rebuild O2C após janela estável.
5. Só então considerar job recorrente.

Comandos já existentes:

```bash
npm run sync:nomus:stock-documents:preview -- --from=YYYY-MM-DD --to=YYYY-MM-DD --tipo=DocumentoSaida
npm run sync:nomus:stock-documents:apply -- --from=YYYY-MM-DD --to=YYYY-MM-DD --tipo=DocumentoSaida
npm run rebuild:order-to-cash-audit:preview
npm run rebuild:order-to-cash-audit:apply
```

---

## 16. Estratégia incremental

| Fase | Comportamento |
|---|---|
| Curto prazo | Janela deslizante manual com overlap (ex.: D-7 → D+0) |
| Médio prazo | Incremental com cursor **após commit** + overlap |
| Periódico | Reconciliação full controlada (não confundir com “incremental” de NF/AR atuais, que são rescans limitados) |
| UI | Somente leitura local; **zero** chamada Nomus no browser |

---

## 17. Plano de implementação em prompts sequenciais

| Prompt | Entrega | Não fazer |
|---|---|---|
| **DS-01** (este) | Auditoria + este documento | UI / migration / permission seed |
| **DS-02** | Probe DB + cobertura real + casos 8451 / PD 02590 / NF 7208 | Alterar regras |
| **DS-03** | Endurecer sync stock (hash, replace seguro, IntegrationRun, lock) | Cron em produção sem gate |
| **DS-04** | Extensão aditiva de cabeçalho (campos confirmados no raw) | Nova tabela master |
| **DS-05** | API list + summary read-only + testes | Raw na lista |
| **DS-06** | API detail (geral/itens/pedidos/NF/financeiro/auditoria) | Mutações |
| **DS-07** | Permission `commercial.output_documents` + menu Comercial | Bypass manual por role name |
| **DS-08** | Página grid + filtros + cards | Ações de escrita |
| **DS-09** | Drawer/detalhe UI completo | Recalcular financeiro paralelo |
| **DS-10** | Allocation link canônico (se DS-02 provar necessidade) | Duplicar O2C como master |
| **DS-11** | Release candidate + smoke + rollback docs | Scope creep |

---

## 18. Critérios de aceite da futura tela

1. Menu Comercial → Documentos de saída com resource permission oficial.
2. Grid paginado server-side só com dados locais.
3. Filtros: período, empresa, cliente, status, pedido, NF, CR.
4. Cards executivos sem N+1 e sem misturar valor doc/NF/CR/pedido.
5. Detalhe com itens, pedidos alocados, NF, CR e auditoria.
6. Precedência financeira CR > condição doc > previsão pedido.
7. Nulls preservados; Decimal/datas corretos; cancelados isolados visualmente.
8. Sem chamada Nomus no browser; sem mutações.
9. rawJson apenas accordion técnico com permissão enforceada.
10. Pedidos antigos sem O2C não quebram a tela (empty states claros).
11. Nenhuma alteração de regra nos domínios protegidos.

---

## Segurança e desempenho (checklist)

| Tema | Diretriz |
|---|---|
| rawJson | omitir na lista; detail gated + sanitize |
| Acesso | `requireResource("commercial.output_documents","view")` |
| Payload | select escalar; sem xmlRaw/rawPayload na lista |
| N+1 | batch por `idNfe` / order links / CR |
| Índices | usar `dataDocumento`, `idNfe`, tipo; adicionar compostos depois |
| Paginação | clamp pageSize |
| Decimal | `decimalToNumber` |
| Timezone | padrão Nomus/BR já usado nos parsers de data |
| Cancelados | NF status 7 + status doc quando normalizado |
| Pedidos antigos | compatível via empty/partial states |

---

## Confirmações de escopo desta auditoria

- ✅ Nenhuma migration criada.
- ✅ Nenhuma tela implementada.
- ✅ Nenhuma permissão cadastrada.
- ✅ Nenhuma regra alterada em Pedido de Venda, NF-e, CR, AP, Fluxo de Caixa, Comissões, Margem, Precificação, BOM ou Estoque.
- ✅ Documento único de saída: `docs/output-documents/current-state-audit.md`.

---

## Apêndice A — Evidências de código

- Schema stock: `prisma/schema.prisma` (`NomusStockDocument` ~2433+)
- Sync: `scripts/nomusStockDocumentsSync.ts`
- Mapper: `src/lib/nomusStockDocumentsMapper.ts`
- Detalhe pedido: `src/lib/sales-orders/salesOrderDetailService.server.ts`
- Audit 360: `src/lib/finance/orderFullAuditService.ts`
- O2C builder: `src/lib/sales/orderToCashAuditBuilder.ts`
- Inventário prévio: `docs/finance/nomus-portfolio-reconciliation-inventory.md`
- Separação financeira: `docs/finance/order-nfe-cr-financial-separation.md`
- Permissões comerciais: `src/lib/security/permissionContract/resources.ts` (`commercial.sales_orders*`)

## Apêndice B — Pendências de ambiente

1. Subir PostgreSQL local / apontar `DATABASE_URL` válido.
2. Medir contagens e % nulos do stage.
3. Materializar relatório dos exemplos 8451 / PD 02590 / NF-e 7208 + CRs.
4. Atualizar este documento na DS-02 com números reais.
