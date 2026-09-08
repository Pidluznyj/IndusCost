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

## CARDINALIDADE FINANCEIRA V1

O espelho `NomusAccountsPayable` **não** carrega `idPedidoCompra`. Não se
afirma que o Nomus imponha "1 título = 1 pedido", nem que um boleto não possa
liquidar vários pedidos. O que existe é um **invariante financeiro do
IndusCost** para impedir dupla contagem:

> Um título pode ter **várias evidências/candidatos** de pedido, mas, enquanto
> não existir rateio financeiro explícito, tem **no máximo um dono
> financeiro**: `FINANCIAL_OWNER(payableExternalId) ∈ { nenhum, exatamente um
> pedido }`. Nunca `{ PO A, PO B }`.

Motivo: título X de R$ 10.000 pago, contado em PO A **e** PO B, viraria
R$ 20.000 atribuídos — dois pedidos "quitados" com o mesmo dinheiro, fornecedor,
Purchase Order 360 e agregações distorcidos.

Autoridade única: `resolvePayableFinancialOwnership`
(`src/lib/nomus/nomusPurchaseOrderPayableOwnership.ts`), alimentada por
**todas** as evidências conhecidas de **todos** os pedidos. Resultado por
título:

| Resultado | Quando | Quem conta |
|-----------|--------|------------|
| `CONFIRMED_OWNER` | um vínculo persistido (camadas 4–5) | o pedido do vínculo — **vence** qualquer evidência automática de outro pedido |
| `AUTO_SINGLE_OWNER` | sem vínculo persistido; evidência automática (camadas 1–3) para **um** pedido — várias evidências para o mesmo pedido **não** são conflito | esse pedido, uma única vez |
| `AUTO_CONFLICT` | sem vínculo persistido; evidência automática para **mais de um** pedido | **ninguém** (0 em todos) até um humano confirmar — nunca se escolhe o "mais forte", o mais novo, o maior ou o primeiro |
| `UNOWNED` | nenhuma evidência | ninguém |
| `CONFIRMED_CONFLICT` (defensivo) | dois vínculos persistidos — impossível após a unique global | ninguém; auditar |

Regras derivadas:

- **Banco**: `payableExternalId` é `@unique` global (migration corretiva
  `20260925120000_nomus_purchase_order_payable_single_financial_owner`). Na
  corrida A × B, uma request vence; a outra recebe P2002 → **409**, nunca 500.
- **Servidor** (`assertPayableFinancialOwnerAvailable`, chamada em toda forma
  de confirmação — sugestão, `INSTALLMENT_MATCH`, `MANUAL`, POST direto):
  dono confirmado em outro pedido → `409
  PAYABLE_ALREADY_LINKED_TO_ANOTHER_PURCHASE_ORDER` ("Este título já está
  vinculado financeiramente a outro pedido."), com `details.ownerOrderId` /
  `ownerOrderNumber`; mesmo par → `409 PAYABLE_ALREADY_LINKED` (idempotente).
  Evidência **automática** de outro pedido não bloqueia a confirmação: o
  vínculo confirmado passa a ter precedência.
- **P2002**: o serviço reconsulta o dono atual (`findFirst` por
  `payableExternalId`) para responder com exatidão; só se o dono já sumiu usa
  `meta.target` do Prisma (`payableExternalId` sozinho → outro pedido; par →
  mesmo pedido). Nunca depende do texto da mensagem.
- **Desvincular libera o dono**: o hard delete da linha ativa permite
  confirmar o título em outro pedido; o histórico
  (`NomusPurchaseOrderPayableLinkHistory`, sem FK para a linha ativa) sobrevive
  e **não** bloqueia o novo dono. Dono é definido por vínculos ativos e
  evidências atuais, nunca pelo histórico.
- **Aba Financeiro, listagem e 360** usam a mesma autoridade em lote
  (`resolvePayableOwnershipAcrossOrders` /
  `resolvePayableOwnershipForOrderPayables`): títulos cujo dono é outro
  pedido ou em conflito continuam **visíveis** (`countsForThisOrder = false`,
  `ownership.kind/label`, badge "Vinculado a outro pedido (PC…)" / "Conflito
  de vínculo") mas ficam **fora** de vinculado/pago/saldo/situação/quitado
  (`totals.excludedByOwnershipCount`, `payableOwnership.excluded` no 360,
  `excludedPayableCount` na listagem). Sugestão de título confirmado em outro
  pedido vem com `confirmable = false` e a UI não oferece "Confirmar vínculo".
- **Cancelado** continua fora dos totais mesmo sendo o dono; **título sumido
  do espelho** continua só aviso (sem inventar valor, status ou dono).
- **Busca reversa em lote** (sem N+1): vínculos confirmados por título (1
  consulta) + pedidos do mesmo fornecedor que declaram as NF-e dos títulos
  (`rawPayload.nfes[].id`, filtro JSON, lotes de 100 NF-e) ou cujo número/ID
  é o `documentNumber` do título, + documentos de entrada por `idNfe` →
  `idPedidoCompra`. Cada pedido encontrado passa pelo mesmo
  `resolveAutomaticPayableLinks` do caminho direto (paridade de regra). Escopo
  deliberado: pedidos do mesmo fornecedor (ou sem fornecedor informado) — uma
  NF-e/número de pedido pertence ao fornecedor. A listagem continua
  apresentando NF-e + confirmados (camadas 2–3 só na aba), mas o **dono** é
  decidido com todas as camadas: nunca conta em dois lugares.

### RATEIO FUTURO

Para um título legitimamente liquidar vários pedidos será preciso um modelo
explícito de alocação (`allocatedAmount` por pedido × título) com o invariante
`SUM(allocatedAmount) <= valor canônico do título`, e a UI/motor passariam a
somar a parcela alocada, não o título inteiro. Está **fora da V1**: sem rateio
não existe split entre pedidos.

## Situação derivada

Por parcela: `UNLINKED` → `LINKED` → `PARTIALLY_PAID` → `PAID`, a partir dos
títulos vinculados àquela parcela que **contam para o pedido** (cancelados e
títulos de outro dono/conflito ficam visíveis, mas não somam).

Por pedido: `financialStatus` (`PLANNED_ONLY`, `PARTIALLY_CONFIRMED`,
`CONFIRMED`, `PARTIALLY_PAID`, `PAID`, `NO_FINANCIAL_DATA`) e `fullySettled`
(todos os títulos que contam para o pedido estão baixados → "Quitado").
A listagem de Pedidos Nomus e a ficha 360 usam os mesmos títulos (NF-e +
confirmados), via `loadConfirmedPayableSnapshotsByOrder`, filtrados pelo dono
financeiro (`partitionPayablesByFinancialOwner`), e `summarizeConfirmedPayables`
ignora cancelados nos totais (o título continua visível na aba Financeiro).

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
`PAYABLE_ALREADY_LINKED` (mesmo pedido),
`PAYABLE_ALREADY_LINKED_TO_ANOTHER_PURCHASE_ORDER` (outro pedido é o dono
financeiro; `details.ownerOrderId`/`ownerOrderNumber`) (409).

## Consultas (por pedido, número constante)

1. pedido (`findUnique`)
2. vínculos persistidos do pedido
3. documentos de entrada que apontam o pedido (`rawJson.idPedidoCompra`)
4. títulos candidatos — **uma** consulta com `OR`: NF-e do pedido, títulos já
   vinculados, fornecedor dentro da janela de vencimento (±400 dias das
   parcelas), fornecedor + `documentNumber` = número do pedido (limite 500)
5. dono financeiro dos candidatos, em lote: vínculos confirmados por título
   (qualquer pedido), pedidos do fornecedor que declaram as NF-e dos títulos
   (por lote de 100 NF-e), pedidos do fornecedor com número = `documentNumber`,
   documentos de entrada por `idNfe` (+ pedidos apontados, se ainda não
   carregados)

Listagem/360: as mesmas consultas de dono em lote para a página inteira
(nenhuma consulta por pedido nem por título).

## Migração

`prisma/migrations/20260924120000_nomus_purchase_order_payable_link` — aditiva:
cria `NomusPurchaseOrderPayableLink` (única por pedido × título, FK `Restrict`
para `NomusPurchaseOrder`) e `NomusPurchaseOrderPayableLinkHistory`. Nenhuma
tabela espelho do Nomus é alterada. **Já aplicada** em homologação
(`applied_steps_count = 1`) — não é editada.

`prisma/migrations/20260925120000_nomus_purchase_order_payable_single_financial_owner`
— corretiva e aditiva: `CREATE UNIQUE INDEX
"NomusPurchaseOrderPayableLink_payableExternalId_key"` sobre
`payableExternalId`. Sem `UPDATE`/`DELETE`, sem deduplicação automática: se um
ambiente tiver o mesmo título em dois pedidos, a migration **falha de
propósito** e o dado é auditado manualmente. O índice não-único antigo
(`_payableExternalId_idx`) e a unique composta são mantidos (redundância
aceita para evitar migration invasiva).

## Arquivos

- Motor puro: `src/lib/nomus/nomusPurchaseOrderPayableLink.ts`
- Dono financeiro (puro): `src/lib/nomus/nomusPurchaseOrderPayableOwnership.ts`
- I/O Prisma: `src/lib/nomus/nomusPurchaseOrderPayableLink.server.ts`
- Rotas: `src/lib/nomusPurchaseOrderPayableLinkRoutes.ts`
- Cliente HTTP: `src/lib/nomus/nomusPurchaseOrderPayableLinkClient.ts`
- UI: `src/components/purchases/NomusPurchaseOrderPayablesPanel.tsx` (aba
  Financeiro de `NomusPurchaseOrderDetailDialog.tsx`)
- Testes: `npm run test:nomus:purchase-orders`
