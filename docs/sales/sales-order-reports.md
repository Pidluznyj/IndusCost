# Relatório Comercial > Pedidos de Venda (PDF + XLSX)

Este documento descreve o **relatório oficial** de pedidos de venda que fica na
tela **Comercial → Pedidos de venda** e segue o **mesmo padrão visual e
funcional** do relatório de **Financeiro → Contas a Receber → Títulos** (analítico).

- **Tela**: Comercial > Pedidos de venda (`/sales-orders`)
- **Botões**: "Exportar PDF" e "Exportar Excel" (padrão AR)
- **Origem oficial**: `SalesOrder` / `SalesOrderItem` (Nomus). **Não usa** `Proposal`.
- **Título institucional**: `COMERCIAL: PEDIDOS DE VENDA`
- **Subtítulo**: "Relatório analítico de pedidos de venda filtrados"
- **Rodapé**: "Documento gerado pelo IndusCost · Origem: Nomus Pedidos de Venda"

## 1. Filtros suportados (idênticos aos da tela)

O relatório respeita **exatamente** o que está aplicado no grid, usando o mesmo
parser (`parseSalesOrderListQuery`):

| Campo UI              | Query param                | Fonte oficial                                    |
|-----------------------|----------------------------|--------------------------------------------------|
| Cliente               | `customerId`               | `SalesOrder.Customer`                            |
| Ano                   | `year`                     | `SalesOrder.issueDate`                           |
| Mês                   | `month`                    | `SalesOrder.issueDate`                           |
| Emissão de/até        | `startDate` / `endDate`    | `SalesOrder.issueDate`                           |
| Status pedido         | `status`                   | `SalesOrder.status`                              |
| Vendedor pedido       | `sellerKey`                | `SalesOrder.externalSellerId` (Nomus)            |
| Busca inteligente     | `q`                        | orderCode, NF, cliente, vendedor, doc externo    |

> Não há filtro por SKU/Produto na tela hoje. Se algum dia for adicionado, a
> query param `productCode` também é aceita, mas hoje ela não é usada.

## 2. Origem dos dados

- **Pedido (cabeçalho)** — `prisma.salesOrder.findMany` com o mesmo `where` do
  grid.
- **Item cancelado/corte/ativo** — `nomusRawResponse.itensPedido[]` normalizado
  por `parseNomusSalesOrderItemStatusFromRawItem`. Status 4 = FULFILLED, 5 =
  FULFILLED_WITH_CUT, 6 = CANCELED (documentado em
  `docs/sales/sales-order-item-status-rules.md`).
- **NF vinculada + valor faturado** — `loadSalesOrderLinkedNfeContextMap`
  (mesma fonte da aba de Status Pedidos).
- **Condição de pagamento (rótulo)** — `resolveSalesOrderListPaymentSummary`.
- **Vendedor** — `buildSalesOrderNomusSellerDto` +
  `formatSalesOrderNomusSellerListLabel` (nunca CRM, nunca setor).
- **Responsável comercial** — `loadManualCommercialOwnersForCustomers` (fonte:
  CRM/carteira). Nunca é "FATURAMENTO" ou "FINANCEIRO".

## 3. Endpoints

Registrados por `registerSalesOrderReportRoutes` (`server.ts`):

- `GET /api/sales-orders/report` — **JSON** consumido pelo PDF (window.print
  client-side, mesmo padrão do AR Títulos). Retorna `SalesOrderReportPayload`.
- `GET /api/sales-orders/report/export.xlsx` — **XLSX branded**
  (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).

Ambos exigem a permissão `sales_orders.view` (mesma da tela).

## 4. Estrutura do PDF (padrão AR)

1. **Cabeçalho institucional** (`PrintHeader`): logo Lazarios Koppetel, slogan,
   CNPJ, endereço, e-mail; título `COMERCIAL: PEDIDOS DE VENDA`; bloco lateral
   com Cliente, Emitido em, Emitido por, Pedidos, Origem.
2. **Texto introdutório**: "Relatório analítico de pedidos de venda filtrados".
3. **Filtros aplicados**: banda azul com todos os filtros ativos.
4. **Resumo Executivo** (KPI cards): Pedidos · Valor original · Valor ativo ·
   Valor cancelado · Valor faturado · Saldo pendente · Ticket médio · Itens
   (ativos / cancelados) · Pedidos com NF · Pedidos sem NF.
5. **Detalhamento analítico** — tabela executiva (12 colunas):
   `Cliente · Empresa · Pedido · Emissão · Entrega · Vendedor · Status · Itens · Valor pedido · Valor ativo · Faturado · Saldo`
   com linha `tfoot` de totais.
6. **Rodapé**: "Documento gerado pelo IndusCost · Origem: Nomus Pedidos de
   Venda" + data/hora de emissão.

CSS de impressão em `src/components/sales/sales-order-report-print.css`
(A4 paisagem, 8mm margem, tipografia consistente com AR, evita página em
branco graças a `page-break-inside: auto` nas seções).

## 5. Estrutura do XLSX (mais completa que o PDF)

- **Aba `Resumo`** — cabeçalho + KPIs (Qtd pedidos, itens ativos/cancel./corte,
  Valor original/ativo/cancelado/cortado/faturado, Saldo, Ticket médio).
- **Aba `Pedidos de venda`** — 29 colunas com:
  Cliente · CNPJ/CPF · Empresa · Pedido · ID Nomus pedido · Data emissão ·
  Entrega prevista · Vendedor pedido · ID Nomus vendedor · Responsável
  comercial · Responsável operacional · Status pedido · Condição de pagamento ·
  Forma de pagamento · Quantidade de itens · Itens ativos · Itens cancelados ·
  Itens com corte · Valor original · Valor cancelado · Valor cortado · Valor
  ativo · Valor faturado · Saldo pendente ativo · NF emitida · Qtde NF-e ·
  Última NF processada em · Documentos de saída/NF · Alertas principais.
- **Aba `Filtros`** — Filtros aplicados (label + valor).

Formatação: freeze pane no cabeçalho, autofilter, `wch` por coluna, formato
monetário `R$ #,##0.00` nas colunas de valor.

## 6. Regras oficiais (contrato)

1. Pedido de Venda é fonte oficial do relatório.
2. Vendedor Pedido vem de `SalesOrder.externalSellerId` (Nomus).
3. Responsável Comercial vem do CRM/carteira do cliente
   (`CrmCustomerCommercialOwner`). **Nunca** aceita "FATURAMENTO"/"FINANCEIRO".
4. Item cancelado (Nomus status 6) **não** entra em pendente/saldo ativo, mas
   aparece em `Itens cancelados` / `Valor cancelado`.
5. Item com corte (Nomus status 5) fica com `activeItemsCount` (foi entregue),
   mas o valor cortado é subtraído do `activeValue`.
6. Valor ativo = Valor original − Valor cancelado − Valor cortado.
7. Saldo pendente = Valor ativo − Valor faturado (nunca negativo).
8. NF vinculada é a mesma fonte da aba **Financeiro → Status Pedidos** (não
   infla valor sem alerta).
9. Se CR/NF real não estiver disponível para uma linha, os campos são zero, não
   forjados. O XLSX reflete isso em "Sem NF" / "Saldo pendente".

## 7. Permissões

- `sales_orders.view` — necessária para os dois endpoints.
- Vendedor com escopo de carteira só verá pedidos dentro do seu escopo (mesma
  aplicação do `where` do grid; herdada de `parseSalesOrderListQuery`).
- Não altera permissões do Contas a Receber oficial.

## 8. Nomes de arquivos

`salesOrderReportExportFilename` (compartilhada):

- `pedidos-de-venda-<slug>-YYYY-MM-DD.pdf`
- `pedidos-de-venda-<slug>-YYYY-MM-DD.xlsx`

Onde `<slug>` é o nome do cliente selecionado (sem acentos, minúsculo,
`-` como separador) ou `todos` se nenhum cliente estiver filtrado.

Exemplos:

- `pedidos-de-venda-britania-eletrodomesticos-sa-2026-07-13.pdf`
- `pedidos-de-venda-todos-2026-07-13.xlsx`

## 9. Diferença entre Pedido de Venda e Proposta

| Aspecto              | Proposta                        | Pedido de Venda (este relatório)              |
|----------------------|---------------------------------|-----------------------------------------------|
| Fonte oficial        | Origem comercial/auditável      | **Sim** — fonte oficial deste relatório       |
| Valor cancelado      | Não aplicável                   | Vem de Nomus (status 6)                       |
| Faturamento          | Não é faturável                 | NF vinculada (SalesOrderNfeLink + NomusNfe)   |
| Comissão             | Não gera                        | Vendedor Nomus é a única fonte                |
| Carteira Comercial   | Não usa                         | Usa `CrmCustomerCommercialOwner`              |

## 10. Padrão visual reaproveitado

- `PrintHeader` — cabeçalho institucional (logo | empresa | documento).
- `printBranding` — CNPJ/endereço/e-mail Lazarios.
- `formatFinanceCurrency` / `formatFinanceDate` / `formatFinanceDateTime` /
  `formatFinanceInteger` — formatadores BR.
- `xlsx` (SheetJS) — mesmo engine do XLSX de Contas a Receber.

## 11. QA / diagnóstico

- **Static + fixture**: `npx tsx scripts/qaSalesOrderReports.ts`
  Valida arquivos, rotas, meta institucional, componentes de impressão, botões
  frontend, service backend, colunas XLSX, helpers de URL, convenção de
  filename, e roda um sanity da agregação com fixtures Britânia (PD 02339 + PD
  02207).
- **Diagnóstico Britânia**:
  `npx tsx tmp-audits/inspect-sales-order-report-britania.ts`
  Roda o loader real contra o banco quando `DATABASE_URL` está definido; do
  contrário, imprime dados de fixture equivalentes.
- **Validações padrão**:
  ```powershell
  npm run check:server-imports
  npm run check:frontend-server-imports
  npm run check:browser-bundle
  npm test
  npm run build
  ```

## 12. Documentos relacionados

- `docs/sales/sales-order-item-status-rules.md` — regras de status do item.
- `docs/finance/portfolio-order-status-tab.md` — mesma origem para NF/faturado.
- `docs/finance/order-full-audit-dialog.md` — Auditoria 360º do Pedido.
