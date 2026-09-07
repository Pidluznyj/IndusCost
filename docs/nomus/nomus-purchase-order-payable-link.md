# Pedido de Compra Nomus ↔ Contas a Pagar

Como a aba **Financeiro** do Pedido Nomus (Compras → Pedidos Nomus → detalhe) liga
as parcelas planejadas do pedido aos títulos do espelho de Contas a Pagar, e como
a baixa do pedido é derivada da baixa dos títulos.

## Princípios

- **Nada é escrito no Nomus.** A baixa do título continua sendo feita no Nomus e
  chega pelo espelho `NomusAccountsPayable`. O IndusCost só guarda o vínculo
  pedido ↔ título e deriva a situação do pedido.
- **Identidade só por chave oficial.** Vínculo automático exige uma chave Nomus
  presente nos dois lados. Nome do fornecedor, descrição ou aproximação de
  valor nunca geram vínculo.
- **Sugestão não é vínculo.** Um par parcela × título só vira vínculo com
  confirmação humana; a confirmação fica registrada com usuário e histórico.
- **Autoridade de baixa única.** Pago/aberto/cancelado vêm de
  `normalizeAccountsPayableTitle` (`src/lib/financeAccountsPayableRules.ts`).
  A situação financeira do pedido vem de `classifyPurchaseOrderFinancialStatus`.

## Camadas de vínculo

| # | Método | Chave | Confiança | Ação humana |
|---|--------|-------|-----------|-------------|
| 1 | `DIRECT_NOMUS_NFE` | `rawPayload.nfes[].id` do pedido = `NomusAccountsPayable.sourceInvoiceId` | EXACT | nenhuma |
| 2 | `STOCK_DOCUMENT_PURCHASE_ORDER` | `NomusStockDocument.rawJson.idPedidoCompra` = pedido → `idNfe` = `sourceInvoiceId` do título | EXACT | nenhuma |
| 3 | `AP_DOCUMENT_NUMBER` | `NomusAccountsPayable.documentNumber` idêntico ao número/ID do pedido **e** mesmo fornecedor | EXACT | nenhuma |
| 4 | `INSTALLMENT_MATCH` | mesmo fornecedor + mesma empresa + valor idêntico + vencimento idêntico (dia civil); forma/conta só reforçam | CONFIRMED | **confirmar** |
| 5 | `MANUAL` | título do mesmo fornecedor escolhido pelo usuário | CONFIRMED | **motivo obrigatório** |

Camadas 1–3 aparecem na tela sem persistir nada (são recalculadas a cada
leitura). Camadas 4–5 persistem em `NomusPurchaseOrderPayableLink` e geram
`NomusPurchaseOrderPayableLinkHistory` (`PURCHASE_ORDER_PAYABLE_LINKED` /
`PURCHASE_ORDER_PAYABLE_UNLINKED`). Vínculos persistidos vencem os automáticos
para o mesmo título (o humano pode ter corrigido a parcela).

Mesmo fornecedor, sozinho, nunca vincula: se faltar valor ou vencimento
idênticos, o título simplesmente não aparece como sugestão.

## Cardinalidade título AP ↔ pedido

O espelho `NomusAccountsPayable` **não** carrega `idPedidoCompra`. Não há
prova, no schema nem no sync atuais, de que um título pertence a um único
pedido ou de que um único boleto possa liquidar vários pedidos com alocação
de valor.

O que o modelo faz hoje:

- unique composta `nomusPurchaseOrderId + payableExternalId` — impede o mesmo
  par duas vezes;
- **não** há unique em `payableExternalId` sozinho — o mesmo título pode ter
  dois vínculos confirmados em pedidos diferentes;
- o servidor só recusa `PAYABLE_ALREADY_LINKED` no mesmo pedido (P2002);
- a UI alerta "Em outro pedido" e ainda oferece confirmação.

Isso é um risco de dupla contagem se o mesmo pagamento de R$ 10.000 for
confirmado em PO A e PO B: cada pedido soma 10.000 no próprio total
vinculado/pago. Agregações que somam esses totais entre pedidos duplicam.

Enquanto a cardinalidade oficial não for comprovada (ou uma regra de alocação
for definida), **não** se adiciona unique indevida nem se bloqueia o segundo
vínculo no backend. A decisão fica para a integração.

Título vinculado a outro pedido é sinalizado ("Em outro pedido") para o
operador conferir.

## Situação derivada

Por parcela: `UNLINKED` → `LINKED` → `PARTIALLY_PAID` → `PAID`, a partir dos
títulos vinculados àquela parcela (cancelados ficam visíveis, mas não somam).

Por pedido: `financialStatus` (`PLANNED_ONLY`, `PARTIALLY_CONFIRMED`,
`CONFIRMED`, `PARTIALLY_PAID`, `PAID`, `NO_FINANCIAL_DATA`) e `fullySettled`
(todos os títulos vinculados **não cancelados** estão baixados → "Quitado").
A listagem de Pedidos Nomus e a ficha 360 usam os mesmos títulos (NF-e +
confirmados), via `loadConfirmedPayableSnapshotsByOrder`, e
`summarizeConfirmedPayables` ignora cancelados nos totais (o título continua
visível na aba Financeiro).

Avisos: total vinculado diferente do planejado; título persistido que sumiu do
espelho; título também vinculado a outro pedido.

## Endpoints

Todos sob `operations.purchases` no contrato de permissões.

| Método | Rota | Guarda | Retorno |
|--------|------|--------|---------|
| GET | `/api/nomus/purchase-orders/:id/payables` | mesmas permissões da listagem (`purchases.view` etc.) | reconciliação |
| POST | `/api/nomus/purchase-orders/:id/payables/links` | `operations.purchases:update` | 201 + reconciliação |
| DELETE | `/api/nomus/purchase-orders/:id/payables/links/:payableExternalId` | `operations.purchases:update` | reconciliação |

POST body: `{ payableExternalId, installmentIndex?, method: "INSTALLMENT_MATCH" | "MANUAL", reason? }`.
`INSTALLMENT_MATCH` só é aceito para uma sugestão que o motor realmente
produziu (senão `409 SUGGESTION_NOT_FOUND`). `MANUAL` exige `reason`.
DELETE body: `{ reason }` (obrigatório). Vínculos automáticos (camadas 1–3) não
são removíveis: não existem como registro.

Códigos: `INVALID_ID`, `INVALID_PAYABLE_EXTERNAL_ID`, `INVALID_INSTALLMENT_INDEX`,
`INVALID_LINK_METHOD`, `PURCHASE_ORDER_PAYABLE_LINK_REASON_REQUIRED` (400);
`PURCHASE_ORDER_NOT_FOUND`, `PAYABLE_NOT_FOUND`, `PAYABLE_LINK_NOT_FOUND` (404);
`PAYABLE_SUPPLIER_MISMATCH`, `PAYABLE_OUT_OF_WINDOW`, `SUGGESTION_NOT_FOUND`,
`PAYABLE_ALREADY_LINKED` (409).

## Consultas (por pedido, número constante)

1. pedido (`findUnique`)
2. vínculos persistidos do pedido
3. documentos de entrada que apontam o pedido (`rawJson.idPedidoCompra`)
4. títulos candidatos — **uma** consulta com `OR`: NF-e do pedido, títulos já
   vinculados, fornecedor dentro da janela de vencimento (±400 dias das
   parcelas), fornecedor + `documentNumber` = número do pedido (limite 500)
5. vínculos dos mesmos títulos em outros pedidos

## Migração

`prisma/migrations/20260924120000_nomus_purchase_order_payable_link` — aditiva:
cria `NomusPurchaseOrderPayableLink` (única por pedido × título, FK `Restrict`
para `NomusPurchaseOrder`) e `NomusPurchaseOrderPayableLinkHistory`. Nenhuma
tabela espelho do Nomus é alterada.

## Arquivos

- Motor puro: `src/lib/nomus/nomusPurchaseOrderPayableLink.ts`
- I/O Prisma: `src/lib/nomus/nomusPurchaseOrderPayableLink.server.ts`
- Rotas: `src/lib/nomusPurchaseOrderPayableLinkRoutes.ts`
- Cliente HTTP: `src/lib/nomus/nomusPurchaseOrderPayableLinkClient.ts`
- UI: `src/components/purchases/NomusPurchaseOrderPayablesPanel.tsx` (aba
  Financeiro de `NomusPurchaseOrderDetailDialog.tsx`)
- Testes: `npm run test:nomus:purchase-orders`
