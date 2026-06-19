# Mapeamento de status — Pedidos de Venda Nomus × IndusCost

Documento gerado a partir da auditoria do código e evidências em produção.
Atualize após rodar `npm run audit:sales-order-statuses` no ambiente com banco.

## 1. Status de cabeçalho

### IndusCost (`SalesOrder.status`)

Valores persistidos no enum Prisma (`SalesOrderStatus`), por exemplo:

- `READY_TO_SEND`
- `SENT_TO_NOMUS`
- `CANCELLED`
- `ERROR`

Esses valores refletem o **fluxo de envio/sincronização** no IndusCost, não o status operacional Nomus.

### Nomus (`nomusRawResponse`)

Campos consultados (aliases em `extractSalesOrderRawField` / `extractNomusHeaderStatusRaw`):

| Campo | Descrição |
|-------|-----------|
| `status` | Status principal |
| `situacao` | Situação textual |
| `descricaoStatus` | Descrição legível |
| `situacaoPedido` | Situação do pedido |
| `statusPedido` | Status alternativo |

Quando ausente: exibir **"Não localizado na integração"**.

## 2. Status de item

Fonte principal: `nomusRawResponse.itensPedido[]`.

Aliases por item (`extractSalesOrderItemRawField`):

- `status`, `situacao`, `situacaoItem`, `situacaoItemPedido`
- `descricaoStatus`, `descricaoStatusItem`, `descricaoSituacaoItem`
- Objetos aninhados `situacaoItemPedido.descricao`

Quantidades mapeadas:

- `quantidade`, `quantidadeAtendida`, `quantidadeFaturada`
- `quantidadeCancelada`, `quantidadeDevolvida`
- `idProduto`, `codigoProduto`, `produto.codigo`, `item`, `id`

## 3. Códigos numéricos encontrados

| Código | Significado | Evidência |
|--------|-------------|-----------|
| `6` | Cancelado | PD 02130 — `itensPedido[].status = 6` |

Demais códigos devem ser preenchidos após `audit:sales-order-statuses` no servidor.

## 4. Códigos mapeados no IndusCost

Definidos em `NOMUS_SALES_ORDER_ITEM_STATUS_BY_CODE` (`salesOrderNomusRaw.ts`):

```ts
{ 6: "cancelled" }
```

Status textuais mapeados via regex em `ITEM_STATUS_RULES` (ex.: `Liberado`, `Atendido totalmente`, `Cancelado`, `Devolvido`).

## 5. Códigos ainda desconhecidos

Qualquer código numérico sem entrada em `NOMUS_SALES_ORDER_ITEM_STATUS_BY_CODE` é tratado como `unknown` e exibido:

> Status Nomus não mapeado: código X

## 6. Status gerencial (IndusCost)

Calculado em `buildSalesOrderLifecycleSummary` (`salesOrderLifecycleStatus.ts`):

- Combina status dos itens, quantidades, NF (`nfes[]`), prazo e OP
- Produz `executiveStatusLabel` (ex.: Faturado no prazo, Atrasado sem NF, Cancelado)
- Mapeado para cards em `salesOrderManagementStatus.ts`

Origem na UI do drawer:

| Tipo | Badge |
|------|-------|
| Dado original Nomus | `nomus_raw` |
| Dado IndusCost | `induscost` |
| Calculado | `calculated` |
| Inferido | `inferred` |
| Ausente | "Não informado" / "Não localizado" / "Não vinculado" |

## 7. Influência de NF, prazo, cancelamento e devolução

| Condição | Efeito |
|----------|--------|
| `nfes[].dataProcessamento` presente | `hasInvoice`, percentual faturado, timeline |
| NF após `expectedDeliveryDate` | `invoiced_late`, risco `invoice_after_deadline` |
| Prazo vencido sem NF | `overdue`, risco `overdue_without_invoice` |
| Todos itens cancelados (cód. 6 ou texto) | Status gerencial cancelado |
| `quantidadeDevolvida` > 0 | Devolução parcial/total |
| `quantidadeCancelada` ou corte | Alertas de corte/cancelamento |

## 8. NF-e vinculada

Extraída de `nomusRawResponse.nfes[]`:

- `numero`, `serie`, `chaveAcesso` / `chave` / `xmlChNFe`
- `dataEmissao`, `dataProcessamento`, `valor`, `status`

Link interno: `/finance/billing` (filtro por `documentNumber` quando disponível).
Rota individual `/finance/nfes/:id` — **não implementada**; pode ser criada futuramente.

## 9. OP / Produção

Chaves no raw: `ordensProducao`, `ordemProducao`, `ops`, `op`, etc.

Sem OP no raw: **"Nenhuma OP vinculada localizada na integração."**

## 10. Exemplos (sem dados sensíveis)

### Pedido liberado com NF parcial

```json
{
  "itensPedido": [{ "status": "Liberado", "quantidade": 10, "quantidadeFaturada": 5 }],
  "nfes": [{ "numero": "12345", "dataProcessamento": "10/06/2026" }]
}
```

→ Status gerencial tende a **Faturado parcialmente**; regra "Possui NF processada? Sim".

### Pedido com item cancelado (código 6)

```json
{ "itensPedido": [{ "status": 6, "quantidade": 1, "quantidadeCancelada": 1 }] }
```

→ Item normalizado `cancelled`; regra "Todos os itens cancelados? Sim".

### Pedido sem raw

→ `nomusRawResponse` ausente; aba Dados Nomus indica indisponibilidade; status Nomus **Não localizado na integração**.
