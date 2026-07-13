# Auditoria Completa do Pedido — modal

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Rota UI** | Financeiro → Conciliação de Carteira → Status Pedidos |
| **Trigger** | Clique numa linha da tabela de pedidos |
| **Componente** | `src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx` |
| **Service** | `src/lib/finance/orderFullAuditService.ts` |
| **Endpoint** | `GET /api/finance/portfolio-reconciliation/orders/:salesOrderId/audit-full` |

## O que mudou

Antes o clique num pedido do grid Status Pedidos abria um bloco embutido “Itens do pedido selecionado” logo abaixo da tabela. Como a auditoria por pedido cresceu (itens, cancelados, cortados, documentos, NF-e, CR, baixas, entrega, frete, alertas), o bloco tornou a tela poluída.

Agora o clique abre um **modal grande** com 7 abas contendo toda a auditoria do pedido. A tabela principal permanece com uma linha por pedido; abaixo dela fica só um hint discreto:

> "Selecione um pedido na tabela acima para abrir a Auditoria completa do pedido — itens, documentos, NF-e, títulos de CR, baixas, entrega e alertas em um único lugar."

Os filtros do Status Pedidos (cards / drilldown / paginação) **não** são afetados ao fechar o modal.

## Abas

1. **Resumo** — 20 KPIs executivos (pedido, cliente, empresa, datas, responsável comercial, vendedor Nomus, valor original / cancelado / cortado / ativo / atendido, %, saldo pendente ativo, CR total/aberto/recebido, temperatura, estágios) + timeline `Pedido → Doc. saída → NF-e → CR → Baixa`.
2. **Itens** — grid próprio (linha do `SalesOrderItem` com status Nomus + qtd atendida/pendente + match confidence) e reuso do `OrderToCashAuditItemsGrid` como evidência item × NF × doc × CR.
3. **Financeiro / Títulos e baixas** — títulos de Contas a Receber vinculados à NF do pedido, deduplicados por `externalId`. Cards Total / Aberto / Recebido / Vencidos / Próx. vencimento / Maior título. Ações: **Copiar referência** e **Abrir no Contas a Receber** (`/finance/accounts-receivable?search=<ref>`).
4. **Documentos de saída** — `NomusStockDocument` agregados via `OrderToCashAuditFact` (qtd doc, qtd usada, excedente, valor total, valor alocado, alerta Excedente / Fora do pedido).
5. **NF-e** — `SalesOrderNfeLink` + `NomusNfe` deduplicados. Cabeçalho oficial + alerta `NF > pedido` e `NF sem CR`.
6. **Entrega / Frete** — Entrega estimada, último documento, última NF, última baixa, condição de frete / pagamento / forma, setor operacional.
7. **Alertas** — lista de alertas com severidade (`critical`, `warning`, `info`), origem, ação recomendada e impacto financeiro estimado.

## Origem dos dados

| Dado | Fonte |
|------|-------|
| Cabeçalho / itens do pedido | `SalesOrder` + `SalesOrderItem` (incluindo flags `nomusIsCanceled / nomusIsCut / nomusIsStale / nomusMatchConfidence`) |
| Evidência item × doc × NF × CR | `OrderToCashAuditFact` (última run que contém o pedido, ou `runId` fornecido) |
| NFe cabeçalho | `NomusNfe` + `SalesOrderNfeLink` (deduplicação por `externalId`) |
| Documento de saída | `NomusStockDocument` |
| Título CR + baixa | `NomusAccountsReceivable` (via `sourceInvoiceId` da NF vinculada) |
| Responsável comercial | Não é preenchido aqui — a coluna do Status Pedidos usa `CrmCustomerCommercialOwner` |

## Regras oficiais respeitadas

- **CR real** do Nomus **prevalece** e é deduplicado por `externalId`. Nunca soma o mesmo CR duas vezes.
- **NF cabeçalho** não infla carteira sem alerta: quando `NF > valor ativo`, aparece alerta `NF_MAIOR_QUE_PEDIDO` (aba Alertas + badge na NF).
- **Item cancelado / stale** aparece na aba Itens com status próprio e alerta; nunca vira pendência.
- **Item cortado** (`FULFILLED_WITH_CUT`) encerra o saldo cortado; não entra em forecast/comissão.
- **Status por LINHA do pedido** — respeitado o `SalesOrderItem.id`; SKU repetido não contamina.
- **Contas a Receber oficial** não é apagado nem alterado. Modal é somente leitura.
- **Fluxo de Caixa / Comissões / Relatório Presidencial / sync Nomus** não são tocados.

## Estados

| Estado | Texto |
|--------|-------|
| Loading | "Carregando auditoria completa do pedido..." |
| Erro | "Não foi possível carregar a auditoria do pedido." |
| Sem dados por aba | Empty state textual centralizado por aba |

## Permissões

`FINANCEIRO_CONCILIACAO_TAB_STATUS_PEDIDOS` (mesma guarda do grid).

## QA / diagnóstico

- `npm run qa:order-full-audit` — QA estático da rota, service, client, dialog e integração da aba.
- `npx tsx tmp-audits/inspect-order-full-audit-pd02339.ts [--order="PD 02339"]` — imprime resumo + itens + CRs + docs + NFs + alertas para o pedido informado. Requer `DATABASE_URL` real.
