# Pedido de Compra Nomus 360º

Espelho **somente leitura** do Pedido de Compra oficial do Nomus, no padrão visual/arquitetural do Pedido de Venda. Não escreve no Nomus e não se mistura com `PurchaseRequest` / `PurchaseOrder` interno.

## Fontes de dados

| Bloco | Fonte | Observação |
| --- | --- | --- |
| Pedido, itens, parcelas | `NomusPurchaseOrder` + `rawPayload` | Mirror local. Sem GET live ao abrir a ficha. |
| Fornecedor | `FinancialSupplier` / `FinancialSupplierAlias` / identidade em `NomusAccountsPayable` | Resolve identidade. Não vincula títulos ao PC. |
| NF-e | `rawPayload.nfes[]` → `NomusNfe.externalId` | Único elo PC → NF aceito nesta fase. |
| Contas a Pagar | `NomusAccountsPayable.sourceInvoiceId` = ID da NF vinculada | Elo financeiro canônico. |
| Documento de entrada | `NomusStockDocument.idNfe` só depois da NF comprovada | Não descobre NF a partir do documento. |
| Produto | `idProduto` → `Product.sourceExternalId` / `NomusProductCatalog` | Resolver existente, em lote no detalhe. |

## Relações determinísticas

1. **Nível A — `DIRECT_NOMUS_NFE`:** `rawPayload.nfes[]` com ID (`id` / `idNfe` / número solto). Confiança `EXACT`.
2. **Nível B — API com chave explícita:** ainda **não comprovado** no tenant Lazarios. Parser aceita `idPedidoCompra` em documento de estoque se aparecer.
3. **NF-e → CP — `NFE_TO_AP`:** `NomusAccountsPayable.sourceInvoiceId` = ID da NF do passo 1.

## Relações não comprovadas / proibidas

- Fornecedor igual + valor parecido + data próxima **não** gera NF nem CP.
- `personId` do CP igual ao fornecedor do PC resolve **nome/CNPJ**, nunca a lista de títulos do pedido.
- Live probe (05/09/2026): `PC00612` e `PC00599` retornaram `nfesCount = 0` mesmo com item `status=4`. `nfes=[]` é tratado como ausência de vínculo, não como “não existe NF no mundo”.
- Documento de estoque oficial tem `idNfe`, sem `idPedidoCompra` observado. `DOCUMENT_ENTRY_LINK_DISCOVERED=NAO`.

## Precedência do fornecedor

1. `FinancialSupplierAlias.externalSupplierId` único → `SUPPLIER_ALIAS` / `EXACT`
2. `FinancialSupplier.normalizedDocument` único → `SUPPLIER_DOCUMENT` / `EXACT`
3. `NomusAccountsPayable.personId` → nome/CNPJ (`SUPPLIER_AP_IDENTITY` / `HIGH`). Ex.: `215` → `SULIFLEX IND. E COM. DE PLASTICOS LTDA`
4. Nome normalizado único → `NAME_FALLBACK` / `FALLBACK`
5. Nome ambíguo ou nenhum match → `UNRESOLVED` (nunca escolhe no silêncio)

## Planejado vs confirmado

- `plannedInstallments` = `rawPayload.parcelas` do Pedido de Compra.
- Total exibido como **Total das parcelas planejadas**, nunca como valor oficial do pedido.
- `confirmedPayables` só existem após NF determinística + `sourceInvoiceId`.
- Status financeiro puro:
  - `PLANNED_ONLY` — parcelas sem CP vinculada
  - `PARTIALLY_CONFIRMED` — há CP, mas o confirmado é menor que o planejado
  - `CONFIRMED` — há CP vinculada e ainda não há pagamento parcial/total
  - `PARTIALLY_PAID` / `PAID` — regras canônicas de `normalizeAccountsPayableTitle`
  - `NO_FINANCIAL_DATA` — sem parcelas e sem CP

## Boleto

`nomeFormaPagamento = Boleto Bancário` é só forma de pagamento.

`BOLETO_DOCUMENTO_DISPONIVEL=NAO` — não há código de barras, linha digitável, PDF ou identificador recuperável no mirror atual.

## Endpoints

- `GET /api/nomus/purchase-orders` — listagem enxuta + resolução em lote
- `GET /api/nomus/purchase-orders/:id` — ficha 360º composta no backend
- `GET /api/nomus/purchase-orders/health`
- Probe read-only: `npm run nomus:purchase-orders:relations-probe`

Raw JSON apenas com `settings.nomus.view` ou `settings.view` e `?includeRaw=1`.

## Performance da listagem

Para a página corrente (25 linhas):

1. 1 query dos PCs (inclui `rawPayload` só no servidor)
2. 1 query de aliases por `supplierExternalId`
3. 1 query de documentos / nomes de `FinancialSupplier` se necessário
4. 1 query de identidade AP por `personId` (não vincula títulos)
5. Extração em memória dos IDs de `nfes[]`
6. 1 query de `NomusNfe` em lote
7. 1 query de CP por `sourceInvoiceId` em lote

Sem N+1 por linha. Sem GET Nomus no clique do modal.

Filtros fiscais/financeiros são aplicados no servidor após o enriquecimento do conjunto filtrado no Prisma — não no navegador.

## Segurança

`NOMUS_WRITEBACK=NAO`. Somente GET no Nomus, e só em scripts de probe/sync já existentes — a UI 360º lê o banco local.
