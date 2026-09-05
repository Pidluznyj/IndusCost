# Contrato Nomus — Pedidos de Compra

**Status:** parcial. Não houve probe HTTP autenticada neste worktree (sem `.env` / `NOMUS_BASE_URL` local).

O parser **não fabrica** um contrato oficial. Ele aceita aliases observados nos irmãos Nomus (`contasPagar`, `contasReceber`, `pedidos`, `recebimentos`) e preserva o `rawPayload` integral para auditoria e reprocessamento.

## Endpoint esperado

| Recurso | Método | Caminho relativo a `NOMUS_BASE_URL` |
| --- | --- | --- |
| Lista | GET | `pedidoscompra?pagina=1&tamanhoPagina=50` |
| Detalhe | GET | `pedidoscompra/{id}` (não usado na 1ª versão; a lista já carrega itens quando presentes) |

`NOMUS_BASE_URL` no projeto já termina em `/rest/`. O cliente oficial é `buildNomusUrl` + `fetchNomusJson` (`src/lib/nomusRestClient.ts`): timeout, retry, 429 com backoff, sem logar token.

## Probe

```bash
npm run nomus:purchase-orders:probe
```

Política: 1 página, `tamanhoPagina=1`, no máximo 2 retries, sem paralelismo, sem escrita no Nomus.

Histórico conhecido: tentativa antiga a `/pedidoscompra?pagina=1` retornou **HTTP 429**. Respeitar `Retry-After`. Não martelar.

## Paginação (inferida dos irmãos)

Campos aceitos no envelope:

- `pagina`
- `tamanhoPagina`
- `totalPaginas` / `totalPages` / `paginas`
- `hasMore`
- arrays em `pedidoscompra`, `pedidosCompra`, `dados`, `data`, `results`, `items`

Parada: página vazia, página menor que `tamanhoPagina`, ou `page >= totalPaginas`.

Janela temporal enviada como `dataInicio` / `dataFim` (`dd/MM/yyyy`), no mesmo espírito de AP/AR. Se a API ignorar esses parâmetros, o sync continua por paginação e a idempotência/hash evita churn.

## Campos de cabeçalho (aliases tolerados)

| Conceito | Aliases lidos | Persistido |
| --- | --- | --- |
| ID oficial | `id`, `idPedidoCompra`, `idPedido` | `externalId` (obrigatório) |
| Número | `numero`, `numeroPedido`, `codigo` | `orderNumber` |
| Fornecedor ID | `idFornecedor`, `idPessoa` | `supplierExternalId` |
| Fornecedor nome | `nomeFornecedor`, `nomePessoa`, `fornecedor` | `supplierName` |
| Documento | `cnpjFornecedor`, `cnpjPessoa`, `cpfCnpj` | `supplierTaxId` |
| Status | `status`, `situacao`, `statusPedido` | `statusRaw` |
| Cancelado | `cancelado`, `cancelada` | `canceled` |
| Emissão | `dataEmissao`, `data`, `dataPedido` | `issuedAt` |
| Previsão | `dataPrevisao`, `dataEntrega`, `previsaoEntrega` | `expectedAt` |
| Criação | `dataCriacao`, `dataHoraCriacao` | `createdAtNomus` |
| Alteração | `dataModificacao`, `atualizadoEm` | `modifiedAtNomus` |
| Condição | `condicaoPagamento`, `nomeFormaPagamento` | `paymentTerms` |
| Observações | `observacoes`, `comentarios` | `comments` |
| Moeda | `moeda`, `siglaMoeda` | `currency` |
| Totais | `valorTotal`, `valorDesconto`, `valorFrete` | decimais opcionais |
| Itens | `itens`, `items`, `pedidosCompraItens` | `NomusPurchaseOrderItem` |

## Campos de item (aliases tolerados)

| Conceito | Aliases |
| --- | --- |
| ID linha | `id`, `idItem`, `idLinha`, `sequencia` |
| Produto | `idProduto`, `codigoProduto`, `descricao` |
| Unidade | `unidade`, `unidadeMedida` |
| Qtd pedida | `quantidade`, `qtde`, `quantidadePedida` |
| Qtd atendida | `quantidadeAtendida`, `quantidadeRecebida` |
| Saldo | `saldo`, `quantidadeSaldo` (ou `pedida − atendida` se ambos existirem) |
| Preço / total | `valorUnitario`, `valorTotal` |

## Exemplo sanitizado (estrutura, não prova de produção)

```json
{
  "id": 90001,
  "numero": "PC-1001",
  "idFornecedor": 77,
  "nomeFornecedor": "Fornecedor Exemplo LTDA",
  "cnpjFornecedor": "<redigido>",
  "status": "Aberto",
  "cancelado": false,
  "dataEmissao": "15/03/2026",
  "dataPrevisao": "20/03/2026",
  "valorTotal": "1.250,50",
  "itens": [
    {
      "id": 1,
      "idProduto": 501,
      "codigoProduto": "MP-001",
      "descricao": "Chapa sanitizada",
      "quantidade": "10,000",
      "quantidadeAtendida": "4,000",
      "valorUnitario": "100,00"
    }
  ]
}
```

## O que precisa ser validado em homolog

1. HTTP 200 em `GET /rest/pedidoscompra?pagina=1`.
2. Nome real do array e de `totalPaginas`.
3. Se `dataInicio`/`dataFim` filtram de fato.
4. Se itens vêm na lista ou só no detalhe `{id}`.
5. Nomes reais de status/cancelamento.
6. Se existe quantidade atendida oficial.

Até lá: `CONTRATO_NOMUS_VALIDADO=PARCIAL`.
