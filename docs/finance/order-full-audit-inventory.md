# Auditoria 360º do Pedido — Inventário técnico

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Tela** | Financeiro → Conciliação de Carteira → Status Pedidos |
| **Trigger** | Clique numa linha do grid |
| **Meta** | Modal "Auditoria 360º do Pedido" com 12 abas alimentadas por 1 único endpoint |
| **Endpoint (base já registrada)** | `GET /api/finance/portfolio-reconciliation/orders/:salesOrderId/audit-full` |
| **Service composer** | `src/lib/finance/orderFullAuditService.ts` |
| **Cliente UI** | `src/lib/finance/orderFullAuditClient.ts` + `src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx` |

Fase atual: **somente inventário e contrato** — nenhuma UI nova, nenhuma migration. Nada de commit/push.

## 1. Pedido de Venda (SalesOrder / SalesOrderItem / SalesOrderNfeLink)

| Model / Arquivo | Finalidade | Campos úteis | Vínculo com SalesOrder | Serviço/API existente | Riscos | Recomendação |
|---|---|---|---|---|---|---|
| `SalesOrder` (`prisma/schema.prisma` L927–974) | Cabeçalho canônico Nomus/IndusCost | `id`, `orderCode`, `proposalId`, `externalSalesOrderId`, `sourceSystem`, `customerId`, `externalCustomerId`, `externalSellerId`, `nomusSellerName`, `responsible`, `companyIssuer`, `externalCompanyId`, `status`, `issueDate`, `expectedDeliveryDate`, `paymentTerms`, `paymentMethod`, `freightCondition`, totais `total*`, `sentToNomusAt`, `nomusRawResponse` | raiz | `orderFullAuditService.ts`, `financePortfolioOrderStatusApi.server.ts`, `salesOrderNomusSync.server.ts`, `salesOrderTraceAudit.server.ts` | Totais do header ≠ soma dos itens; `responsible` é setor, não vendedor comercial | Metadados só via header; valores operacionais via facts + itens |
| `SalesOrderItem` (L1018–1070) | Linha do pedido | `id`, `productId`, `externalProductId`, `skuSnapshot`, `productNameSnapshot`, `quantity`, `unit`, `unitCost`, `negotiatedPrice`, `totalNetValue`, `totalCost`, `marginValue`, `marginPerc`, `nomusItemExternalId`, `nomusItemSequence`, `nomusItemStatusRaw/Normalized`, `nomusQuantityFulfilled/Pending`, `nomusIsCanceled/Cut/Stale`, `nomusMatchConfidence/Reason`, `nomusRawItem`, `proposalItemId` | `salesOrderId` | `orderFullAuditService.ts`, `orderToCashFactItemStatusEnrichment.server.ts`, `salesOrderMarginService.server.ts` | SKU repetido → `matchConfidence=AMBIGUOUS`; `unitCost` é preço comercial Nomus, não custo industrial | Status/valores sempre por `SalesOrderItem.id`, nunca por SKU |
| `SalesOrderNfeLink` (L977–1016) | Vínculo Pedido↔NF | `salesOrderId`, `nfeExternalId`, `nfeNumber/Serie/Key`, `nfeStatus`, `tipoOperacao`, `dataProcessamento`, `nomusNfeId`, `presentInLastPayload` | `salesOrderId` | `salesOrderNfeLink.ts`, `orderFullAuditService.ts` | Uma NF pode cobrir vários pedidos; link órfão quando NF some do payload | Primária para listar NFs; complementar com `NomusNfe` p/ cabeçalho fiscal |

## 2. Proposta (Proposal / ProposalItem)

| Model | Finalidade | Campos úteis | Vínculo | Serviço | Riscos | Recomendação |
|---|---|---|---|---|---|---|
| `Proposal` (L781–845) | Proposta comercial de origem | `id`, `number`, `customerId`, `status`, `responsible`, `paymentTerms`, `paymentMethod`, totais `total*`, `externalProposalId/Code`, `priceTableId`, `priceTableVersionId`, `priceSource` | `SalesOrder.proposalId` (1:1 opcional) | `salesOrderTraceAudit.server.ts`, `proposalInternalManagementPdf.server.ts`, `proposalItemEstimatedCommission.ts` | Pedido importado do Nomus pode não ter proposta; totais divergem após negociação | Origem comercial auditável — **nunca** substituir valores do pedido |
| `ProposalItem` (L847–892) | Linha da proposta | `productId`, `quantity`, `unitCost`, `suggestedPrice`, `negotiatedPrice`, `marginValue/Perc`, `commissionPerc/Value`, `priceTableItemId`, `pricingSnapshotJson`, `externalItemId` | `SalesOrderItem.proposalItemId` | `proposalItemCostBreakdown.ts` | Nem todo SOI tem `proposalItemId` | Comparativo linha a linha quando FK existir |
| `CommercialActivity` (L1338–1374) | Atividades CRM | `salesOrderId`/`proposalId`, `activityType`, `status`, `assignedTo`, datas | opcional | `commercialActivityApi.ts` | Timeline não obrigatória | Bloco opcional na aba Proposta |

## 3. Auditoria Pedido → Caixa

| Model | Finalidade | Campos úteis | Vínculo | Serviço | Riscos | Recomendação |
|---|---|---|---|---|---|---|
| `OrderToCashAuditRun` (L5311–5351) | Metadados da materialização | `id`, `status`, `mode`, `year`, `periodFrom/To`, `customerFilter`, `totalOrders`, `totalFacts`, agregados, `warningsJson` | facts têm `runId`+`salesOrderId` | `financeOrderToCashAuditApi.server.ts`, `scripts/rebuildOrderToCashAudit.ts` | Run desatualizada → UI stale | Exibir `runId`+`finishedAt` no modal |
| `OrderToCashAuditFact` (L5355–5571) | Evidência item × doc × NF × CR × estágios | `salesOrderId`, `salesOrderItemId`, `lineType`, valores, flags item; `stockDocumentExternalId`, `quantityUsedForOrder`, `allocatedValueByOrderPrice/DocumentPrice`, `excessQuantity`, `outsideOrderQuantity`; `nfeExternalId`, `nfeNumber`, `nfeHeaderValue`, `nfeItem*`; `receivableIdsJson`, `receivableTotalValue/Open/Received`, `paymentDueDate/SettlementDate`, `paymentStatus`; estágios `operationalStage/fiscalStage/financialStage/orderToCashStage`, `temperature`, `confidenceScore/Label`, alertas booleanos + `alertsJson`, `responsibleArea`, `recommendedAction` | `salesOrderId` | `orderFullAuditService.ts`, `financePortfolioOrderStatusApi.server.ts`, `orderToCashAuditItemsUi.ts`, `orderToCashFactItemStatusEnrichment.server.ts`, motor `sales/orderToCashAuditBuilder.ts` | **CR em múltiplos facts** infla carteira; NF header repetido por linha; item repetido em `ORDER_ITEM_ALLOCATED` + `QUANTITY_SURPLUS` | Facts = evidência; CR oficial só via `NomusAccountsReceivable` dedup por `externalId` |
| `PortfolioReconciliationFact` (L2325–2407) | Camada paralela | mesma essência + `forecastSource`, `confidenceLevel`, `traceJson` | `salesOrderId` | `portfolioReconciliationReceivables.ts`, `orderToCashAuditToPortfolioFactsAdapter.ts` | Duplica O2C com schema diferente | Não usar como fonte primária do 360º |
| `portfolioOrderStatusService.ts` | Consolidação 1 linha/pedido | `activeOrderValue`, `canceledOrderValue`, `cutOrderValue`, `lineBilledValue`, `consolidatedStatus` | Agrupa facts por `salesOrderId` | grid Status Pedidos | Soma indevida de `orderNet`/CR se não consolidar | Reusar helper no summary do modal |

## 4. Documentos de saída

| Model | Finalidade | Campos úteis | Vínculo | Serviço | Riscos | Recomendação |
|---|---|---|---|---|---|---|
| `NomusStockDocument` (L2217–2238) | Documento estoque Nomus | `externalId`, `idNfe`, `tipoDocumentoEstoque`, `dataDocumento`, `rawJson` | via `OrderToCashAuditFact.stockDocumentExternalId` | `orderFullAuditService.ts`, motor O2C | Doc sem pedido; produto fora do pedido | Agregar por `externalId`; quantidades/valores alocados vêm dos facts |
| `NomusStockDocumentItem` (L2240–2261) | Linha do documento | `externalItemId`, `externalProductId`, `quantity`, `unitValue`, `estimatedTotalValue`, `rawJson` | match produto no fact | motor O2C | `hasPriceMismatch` doc≠pedido | Detalhe linha via facts |

## 5. NF-e

| Model | Finalidade | Campos úteis | Vínculo | Serviço | Riscos | Recomendação |
|---|---|---|---|---|---|---|
| `NomusNfe` (L2433–2490) | NF-e oficial sincronizada | `externalId`, `numero`, `serie`, `chave`, `status`, `tipoOperacao`, `dataProcessamento`, `xmlDhEmi`, `valorLiquido`, `xmlVNF`, `billingClassification`, `isFiscalBilling`, `isMarketSale` | `SalesOrderNfeLink.nfeExternalId`; CR via `sourceInvoiceId` | `orderFullAuditService.ts`, sync Nomus | Cabeçalho NF > pedido; NF logística/intercompany não é receita | Cabeçalho de `NomusNfe`; alocação via facts; alerta `NF_MAIOR_QUE_PEDIDO` |
| Itens NF | — | Sem model Prisma; desnormalizado em `OrderToCashAuditFact.nfeItem*` | via fact | motor O2C | Item NF ≠ item pedido | Não inventar itens NF fora do fact |

## 6. Contas a Receber

| Model | Finalidade | Campos úteis | Vínculo | Serviço | Riscos | Recomendação |
|---|---|---|---|---|---|---|
| `NomusAccountsReceivable` (L2076–2139) | Título CR oficial | `externalId`, `sourceInvoiceId/Number`, `dueDate`, `competenceDate`, `scheduleDate`, `settlementDate`, `amountReceivable`, `amountScheduled`, `amountReceived`, `balanceReceivable`, `status`, `paymentMethodName`, `bankAccountName`, `personName/Cnpj`, `companyName`, `description` | `sourceInvoiceId` → `NomusNfe.externalId` → `SalesOrderNfeLink` → `SalesOrder` | `orderFullAuditService.ts`, `financeAccountsReceivableManagement.ts`, `financeAccountsReceivableDashboard.js`, `portfolioReconciliationReceivables.ts` | Mesmo CR em vários facts; CR sem `sourceInvoiceId`; parcelas múltiplas por NF | **Dedup por `externalId`**; status = `settlementDate + amountReceived + balanceReceivable` |
| Baixa/recebimento | — | Sem tabela separada; embutido no CR | — | `isReceivableSettled` em `portfolioReconciliationReceivables.ts` | Baixas parciais reduzidas a saldo agregado | Derivar `RECEIVED/PARTIAL/OVERDUE/OPEN` (já feito no service) |
| `CommissionReceiptLedgerLine` (L5113–5179) | Baixa **de comissão** | `nomusReceivableId`, `settlementDate`, `receivedAmount`, `orderCode`, `nfeNumber` | `orderCode` | `commissionReceiptLedger.ts`, `commissionReceiptClosing.server.ts` | Camada comissão, não financeiro oficial | Aba Comissões, não misturar com CR gerencial |

## 7. Margem, Preço, Custo

| Model | Finalidade | Campos úteis | Vínculo | Serviço | Riscos | Recomendação |
|---|---|---|---|---|---|---|
| `PriceTable` / `PriceTableVersion` / `PriceTableItem` (L1073–1143) | Tabela comercial + versão publicada | `code`, `defaultMarginPct`, `versionNumber`, `status`, `effectiveFrom/To`, `productionCostTableVersionId`; PTI: `frozenTotalCost`, `marginPct`, `salePrice`, `commissionPerc`, `costSnapshotJson` | via `Proposal.priceTableVersionId` ou por data do pedido | `salesOrderMarginPriceResolver.server.ts`, `salesOrderMarginOfficialPrice.ts` | Tabela na data ≠ tabela da proposta | Referência oficial vs preço negociado |
| `ProductionCostTableVersion` / `ProductionCostTableItem` (L1146–1202) | Custo industrial versionado | `unitProductionCost`, breakdown material/process/labor/machine | resolvido por `issueDate` + `productId` | `salesOrderMarginResolver.server.ts`, `getEffectiveProductProductionCost` | Custo vivo ≠ snapshot do pedido | Não usar `SalesOrderItem.unitCost` como custo industrial |
| `ProductBOM` (L589–610) | BOM estrutural | `productId`, `materialId/childProductId`, `quantity` | contexto | cálculo upstream | Não é venda | Só contexto |
| `salesOrderMarginService.server.ts` | **Motor oficial de margem** | `marginSummary`, `itemMargins`, status `OK/SEM_CUSTO/ITEM_CANCELADO/MARGEM_NEGATIVA`, cobertura de custo | input pedido/itens | listagens vendas | Cancelados/cortados excluídos (correto) | Aba Margem: chamar `calculateSalesOrderMarginsForOrders` |

## 8. Comissão

| Model | Finalidade | Campos úteis | Vínculo | Serviço | Riscos | Recomendação |
|---|---|---|---|---|---|---|
| `CommissionOrderSnapshot` (L5200–5232) | Snapshot comissão na venda | `salesOrderId`, `nfeId`, `canonicalSellerId`, `totalSoldAmount`, `totalFinalCommissionAmount`, `status`, `sourceHash` | FK `salesOrderId` | `commissionOrderMaterializer.server.ts`, `commissionTraceAudit.server.ts` | Múltiplos snapshots (`STALE/SUPERSEDED`) | `ACTIVE` mais recente (+ `nfeId` se NF específica) |
| `CommissionOrderItemSnapshot` (L5234–5264) | Comissão por linha | `salesOrderItemId`, `soldAmount`, `marginPercent`, `commissionRatePercent`, `finalCommissionAmount`, `ruleId`, `status`, `exclusionReason` | FK `salesOrderItemId` | idem | Cancelado/cortado → exclusão | 1:1 com SOI ativo |
| `CommissionReceivableSchedule` (L5276–5306) | Rateio comissão por título CR | `orderSnapshotId`, `receivableId`, `scheduledCommissionAmount`, `nfeId`, `salesOrderId` | FK | `commissionReceivableScheduler.server.ts`, `commissionReceivableForecast.server.ts` | Schedule órfão | Previsão de liberação por parcela |
| `CommissionReceiptLedgerLine` (L5113+) | Baixa por recebimento | `nomusReceivableId`, `settlementDate`, `expectedCommissionAmount`, `releasedCommissionAmount`, `orderCode` | `orderCode` | `commissionReceiptLedger.ts` | Fechamento pode supersedir | Baixas de comissão |
| `CommissionPerson` / `CommissionPersonAlias` (L4724–4773) | Vendedor canônico + aliases | `nomusPersonId`, aliases `rawSellerId/rawSellerName` | via resolução | `commissionSellerIdentity.server.ts` | Vendedor pedido ≠ vendedor canônico | Mostrar raw + canônico |
| `CommissionRule` / `CommissionCustomerExclusionRule` | Regras e exclusões | `ratePercent`, condições, `exclusionReason` | avaliadas na materialização | `commissionOrderCalculation.ts` | Exclusão retroativa | Exibir motivo por item |

## 9. CRM

| Model | Finalidade | Campos úteis | Vínculo | Serviço | Riscos | Recomendação |
|---|---|---|---|---|---|---|
| `Customer` (L747–779) | Cadastro cliente | `id`, `companyName`, `tradeName`, `taxId`, `segment`, `accountOwner`, `relationshipStatus` | `SalesOrder.customerId` | `orderFullAuditService.ts`, CRM APIs | `accountOwner` texto livre ≠ owner CRM estruturado | Header cliente + `SalesOrder.externalCustomerId` |
| `CrmCustomerCommercialOwner` (L1408–1431) | **Responsável comercial** (manual — prevalece) | `sellerExternalId`, `sellerResponsibleName`, `sellerCanonicalName`, `sellerIdentityKey`, `sellerAliasExternalIds`, `assignmentSource`, `isActive` | `customerId` | `crmCustomerCommercialOwner.ts`, `loadManualCommercialOwnersForCustomers` | Ausência → coluna vazia | Preencher `commercialResponsibleName` no modal (gap atual) |
| Resolução responsável | Inferência quando sem manual | agrega pedidos do cliente | via `externalSellerId/nomusSellerName` | `inferCommercialOwnerFromNomusOrders` | Inferência ≠ carteira oficial | Manual prevalece; inferência fallback com badge |

## Gaps de síntese (a resolver no service)

| Gap | Detalhe | Ação sugerida |
|---|---|---|
| **Proposta** | Modal atual não carrega `Proposal`/`ProposalItem` | Join opcional por `proposalId`/`proposalItemId`; aba comparativa proposta × pedido |
| **Margem** | Totais em SO/SOI existem; recálculo rico não está no payload | Chamar `calculateSalesOrderMarginsForOrders` no `loadOrderFullAudit` |
| **Comissão** | Snapshots + ledger existem; modal ignora | Incluir `CommissionOrderSnapshot` + items + `CommissionReceivableSchedule` + ledger por `orderCode` |
| **Responsável comercial CRM** | Grid usa `loadManualCommercialOwnersForCustomers`; modal retorna `null` | Reusar mesmo helper |
| **`externalCustomerId` no summary** | Service tenta ler de `Customer` (campo inexistente) | Usar `SalesOrder.externalCustomerId` |
| **NF sem `externalId` no fact** | Placeholder com id negativo (`surrogate`) | Resolver via `nfeNumber`→`NomusNfe` ou `SalesOrderNfeLink` |
| **CR inferidos** | Facts trazem `receivableIdsJson` | Complementar dedup quando link seguro |
| **PortfolioReconciliationFact** | Camada paralela | Só comparação/auditoria cruzada, não fonte primária |
| **Timeline unificada** | 5 marcos hoje; falta proposta/comissão/atividade | Estender `buildTimeline` |
| **Condição de pagamento planejada** | Facts têm `paymentTermsJson`/`plannedInstallmentsCount` | Cronograma previsto vs CR real (`extractSalesOrderForecastInstallments`) |

## Riscos de duplicidade / inflação

1. **CR duplicado em facts** → dedup por `NomusAccountsReceivable.externalId`.
2. **NF cabeçalho ≠ soma itens** → alerta `NF_MAIOR_QUE_PEDIDO`; nunca somar `nfeHeaderValue` como receita.
3. **Proposta duplicando pedido** → nunca usar `Proposal.total*` como valor operacional.
4. **Documento de saída agregado em facts** → agregar por `stockDocumentExternalId`.
5. **Vendedor triplo** → `SalesOrder.nomusSellerName` (Nomus) × `CrmCustomerCommercialOwner` (CRM) × `CommissionPerson` (comissão) — conceitos distintos, não fundir.
6. **Margem dupla** → `SalesOrderItem.marginValue` persistido vs recálculo com custo versionado — indicar fonte na UI.
7. **Comissão em 3 camadas** → snapshot venda + previsão + baixa; cada uma responde pergunta diferente.
8. **SKU repetido / match ambíguo** → respeitar `nomusMatchConfidence` e `salesOrderItemId` sempre.
9. **Run O2C stale** → exibir `runId` + `finishedAt`.
10. **Baixas parciais** → só saldo agregado no schema atual; auditoria fina depende do `rawPayload`.

## Contrato-alvo do endpoint

`GET /api/finance/portfolio-reconciliation/orders/:salesOrderId/audit-full`

Parâmetros:

- `runId` — opcional; se omitido, resolve última run que contém o pedido.
- `orderCode` — opcional (auditoria de fallback quando `salesOrderId` não existe).
- `includeRaw` — opcional, default `false`. Só liga o bloco `technicalAudit.rawPayloads` quando `true`.

Blocos de retorno (12 seções, `ok: true` + `runId` + `salesOrderId`):

| Bloco | Fonte | Campos-chave |
|-------|-------|--------------|
| `summary` | SalesOrder + Customer + facts + CRM owner | orderCode, cliente, empresa, datas, responsável comercial, vendedor Nomus, valores original/cancelado/cortado/ativo/atendido, %, saldo pendente, CR total/aberto/recebido, estágios, temperatura, status consolidado |
| `proposal` | `Proposal` + `ProposalItem` | number, priceTableCode/version, priceSource, `totals`, `items[]` (comparativo com SOI: `proposalItemId → salesOrderItemId`), status, `deltasVsSalesOrder` (diferenças de qtd/preço/margem) |
| `salesOrder` | `SalesOrder` cabeçalho | orderCode, status, issueDate, expected, sourceSystem, `identifiers` (external ids), sellerName, `paymentTerms/Method/FreightCondition`, totais, `sentToNomusAt`, `syncedAt`, `nomusRawResponsePresent` |
| `orderItems` | `SalesOrderItem` + facts item | linha a linha com sequência, produto, quantidades, precificação, `marginValue/Perc` persistido, `nomusItemStatus*`, flags `isCanceled/isCut/isStale`, `matchConfidence/Reason`, `linkedStockDocuments[]`, `linkedNfeExternalIds[]` |
| `stockDocuments` | agregado por `stockDocumentExternalId` | `tipoDocumentoEstoque`, `dataDocumento`, `idNfe`, qtds/valores, `hasExcess/hasOutside`, `productLines[]` |
| `nfes` | `SalesOrderNfeLink` + `NomusNfe` | dedup por `externalId`, `numero/serie/chave`, `dataEmissao/Processamento`, `valorLiquido`, `allocatedValueToOrder`, `headerGreaterThanOrder`, `hasReceivable`, `linkedStockDocumentExternalIds[]` |
| `receivables` | `NomusAccountsReceivable` (dedup) | por título: valores, `status` derivado (`RECEIVED/PARTIALLY_RECEIVED/OVERDUE/OPEN`), `settlementDate`, `paymentMethodName`, `linkedNfeExternalIds[]`, `origin` (`NFE/SOURCE_INVOICE/INFERRED/UNKNOWN`) |
| `receipts` | `NomusAccountsReceivable` (settled) + opcional `CommissionReceiptLedgerLine` | baixas efetivas: `receivableExternalId`, `settlementDate`, `receivedAmount`, `bankAccountName` |
| `delivery` | `SalesOrder` + facts | expected, últimos marcos (doc, NF, baixa), `freightCondition`, `paymentTerms/Method`, `setorOperacional` (`SalesOrder.responsible`) |
| `freight` | `SalesOrder.freightCondition` + `nomusRawResponse` (subset) | modalidade, valor de frete, transportadora (se existir) |
| `marginPricing` | `salesOrderMarginService` + `PriceTable*` + `ProductionCostTableVersion` | `marginSummary`, `itemMargins[]` (status por item), `officialPriceReference[]` (tabela vs negociado), `costSource/Confidence` |
| `commissions` | `CommissionOrderSnapshot` + items + `CommissionReceivableSchedule` + ledger | `snapshotStatus`, `canonicalSellerId/Name`, totais + por item, cronograma por CR, baixas de comissão, exclusões (`exclusionReason`) |
| `divergences` | derivado dos facts + `hasNfeHeaderGreaterThanOrder`, `hasPriceMismatch`, `hasProductOutsideOrder`, etc. | alertas com `code/severity/description/action/financialImpact` (superset dos atuais) |
| `technicalAudit` | metadata + `runId`/`finishedAt` + (só se `includeRaw=true`) `rawPayloads` | `orderToCashRunId`, `orderToCashFinishedAt`, `syncedAt` das entidades, `matchConfidenceSummary`, `rawPayloads?` (accordion) |

Todos os blocos são **read-only**. O modal atual já entrega `summary`, `orderItems` (parcial), `stockDocuments`, `nfes`, `receivables`, `delivery`, `alerts`. Faltam `proposal`, `salesOrder` (bloco isolado), `receipts`, `freight`, `marginPricing`, `commissions`, `divergences` (hoje entra dentro de `alerts`) e `technicalAudit`.

## Próximos passos (não incluídos nesta fase)

1. Estender `orderFullAuditService.ts` com stubs tipados para os 6 blocos ainda ausentes (esta fase adiciona só os **types**, sem lógica pesada).
2. Renomear a UI de "Auditoria completa" → "Auditoria 360º do Pedido" e expandir 7 → 12 abas.
3. Adicionar helper de composição de proposta / margem / comissão em prompts futuros, um bloco por vez.
4. QA por bloco antes de habilitar na UI.
5. Adicionar `runId + finishedAt` no cabeçalho do modal.
