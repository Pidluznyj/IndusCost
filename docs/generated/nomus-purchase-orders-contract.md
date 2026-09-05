# Contrato Nomus — Pedidos de Compra

**Status:** validado ao vivo em 05/09/2026.

Probe autenticada:

```text
GET https://lazarios.nomus.com.br/lazarios/rest/pedidoscompra
```

Resultado:

* HTTP 200
* payload raiz = **array**
* 50 registros na primeira página (limite observado)
* sem status de cabeçalho; a fase vem dos itens

O cliente oficial continua sendo `buildNomusUrl` + `fetchNomusJson`. Recurso: `pedidoscompra`.

## Probe operacional

```bash
npm run nomus:purchase-orders:probe
```

Política: poucas requisições, timeout, retry de 429, sem escrita no Nomus.

## Paginação

Observado/confirmado:

* raiz = array de pedidos
* primeira página = 50 registros
* query usada: `pagina` + `tamanhoPagina`

Ainda não confirmado no live:

* `totalPaginas` / `hasMore` no envelope (a raiz é array, não objeto)
* se `dataInicio` / `dataFim` filtram de fato

Parada conservadora: página vazia, página menor que `tamanhoPagina`, ou fim de `totalPaginas` se o envelope trouxer.

## Campos oficiais de cabeçalho (validados)

| Campo Nomus | Persistido | Notas |
| --- | --- | --- |
| `id` | `externalId` | obrigatório |
| `codigoPedido` | `orderNumber` | ex.: `PC00612` |
| `idPessoaFornecedor` | `supplierExternalId` | ex.: 215; **sem nome** no payload |
| `idPessoaComprador` | — | só no raw |
| `idEmpresa` | — | só no raw |
| `dataEmissao` | `issuedAt` | `dd/MM/yyyy` |
| `dataEntregaPadrao` | `expectedAt` | `dd/MM/yyyy` |
| `condicaoPagamentoTexto` | `paymentTerms` | pode ser `"."` |
| `observacoes` | `comments` | quando presente |
| `itensPedidoCompra` | itens | array oficial |
| `parcelas` | — | só no raw; não é Contas a Pagar |
| `valorTotalFrete` | `freightAmount` | |
| `valorTotalSeguro` | — | só no raw (sem coluna nova) |
| `valorTotalOutrasDespesasAcessorias` | — | só no raw |

**Não presentes / não confirmados no live:**

* nome do fornecedor / CNPJ
* status textual de cabeçalho
* `valorTotal` de cabeçalho
* `quantidadeAtendida` / saldo
* `dataModificacao` confiável para incremental

`totalAmount` do cabeçalho **não é calculado** a partir das linhas nesta versão.

## Campos oficiais de item (validados)

| Campo Nomus | Persistido / mapeado | Notas |
| --- | --- | --- |
| `item` | `lineCode` (memória) + raw | texto; preservar zeros (`"000010"`). **Não** vira `lineExternalId` |
| `idProduto` | `productExternalId` | |
| `quantidade` | `orderedQuantity` | |
| `valorUnitario` | `unitPrice` | BR `"62,77"` → 62.77 |
| `status` | código 1–8 no raw | status **do item**, não do cabeçalho |
| `idUnidadeMedida` | — | só no raw |
| `idSetorEntrada` | — | só no raw |
| `idTipoMovimentacao` | — | só no raw |
| `percentualDesconto` / `valorDesconto` | — | só no raw |
| `dataEntrega` | — | quando existir no item |
| `observacoes` | — | do item, no raw |

`quantidadeAtendida` **não veio** na listagem. `receivedQuantity` fica null. Status 4 **não** fabrica quantidade recebida.

## Status oficial dos itens

```text
1 = Aguardando liberação   WAITING_RELEASE
2 = Liberado               RELEASED
3 = Atendido parcialmente  PARTIALLY_RECEIVED
4 = Atendido totalmente    FULLY_RECEIVED
5 = Atendido com corte     RECEIVED_WITH_CUT
6 = Cancelado              CANCELED
7 = Devolvido parcialmente PARTIALLY_RETURNED
8 = Devolvido totalmente   FULLY_RETURNED
```

## Fase canônica do pedido

O live não traz status de cabeçalho. A fase é derivada dos status dos itens:

| Itens | Fase |
| --- | --- |
| todos `1` | `OPEN` |
| todos `2` | `APPROVED` |
| mistura só `1`+`2` | `OPEN` |
| todos `3` ou algum `3`/`5`/`7` | `PARTIALLY_RECEIVED` |
| todos `4` | `RECEIVED` |
| `4` + aberto/liberado/cancelado/devolvido | `PARTIALLY_RECEIVED` |
| todos `6` | `CANCELED` |
| todos `5` ou todos `7` | `PARTIALLY_RECEIVED` (conservador; não é RECEIVED) |
| todos `8` ou só `6`+`8` | `UNKNOWN` (não inventar cancelamento/recebimento) |

Um único item `2` (caso PC00612) → `APPROVED`.

## Exemplo sanitizado real (PC00612)

```json
{
  "codigoPedido": "PC00612",
  "condicaoPagamentoTexto": ".",
  "dataEmissao": "02/09/2026",
  "dataEntregaPadrao": "11/09/2026",
  "id": 613,
  "idPessoaFornecedor": 215,
  "itensPedidoCompra": [
    {
      "idProduto": 1292,
      "item": "000010",
      "quantidade": "50",
      "status": 2,
      "valorUnitario": "62,77"
    }
  ],
  "valorTotalFrete": "0"
}
```

Aliases anteriores (`numero`, `itens`, `idFornecedor`, …) continuam aceitos para não quebrar fixtures antigas.
