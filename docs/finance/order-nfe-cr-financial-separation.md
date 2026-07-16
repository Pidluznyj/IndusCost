# Pedido × NF × CR × planejado — conceitos oficiais

**Atualizado:** 2026-07-16  
**Caso âncora:** PD 02457 (Esmaltec S/A)

## Conceitos

| Conceito | Fonte oficial | Observação |
|----------|---------------|------------|
| Valor do pedido / ativo | `SalesOrder.totalNetValue` − cancelados/cortes | Motor de Pedido de Venda — não alterar |
| Produtos da NF | `NomusNfe.valorLiquido` (= vProd − vDesc) | Base sem IPI/encargos do vNF |
| Total NF válido | Preferência `NomusNfe.xmlVNF` (vNF) | Base fiscal **comparável** ao pedido |
| Impostos destacados | `max(0, xmlVNF − valorLiquido)` quando ambos existem | **Não** é “impostos pagos”; sem IPI/ICMS/PIS individuais no schema atual |
| A faturar | `max(0, ativo − total NF válido)` | Indicador **operacional** |
| CR original / recebido / aberto | `NomusAccountsReceivable` via `sourceInvoiceId` | Não recalcular |
| Saldo financeiro | Soma de `balanceReceivable` dos CRs oficiais | **Nunca** pedido − NF |
| Recebível planejado | Condição de pagamento do pedido | Só entra no total se **não** substituído |
| Total financeiro | CR original + planejado **aplicável** | Planejado substituído = evidência apenas |

## Regras explícitas

1. **Saldo financeiro nunca é calculado pela diferença entre Pedido e NF.**
2. **Quando existir CR real, o recebível planejado correspondente não participa novamente do total financeiro.**
3. NF cancelada aparece na auditoria e **não** entra no faturamento válido / totalizadores.
4. Sem CR gerado → saldo financeiro = “—” / “Sem CR gerado” (não inventar saldo).

## PD 02457 — causa dos R$ 129,19

- Campo que produzia R$ 3.975,00: `NomusNfe.valorLiquido` (produtos líquidos).
- Campo oficial do total NF: `NomusNfe.xmlVNF` = R$ 4.104,19.
- Diferença R$ 129,19 = impostos/encargos destacados no total da NF (tipicamente IPI no vNF), agora expostos como `highlightedTaxesValue`.

## Total financeiro R$ 8.208,38

Bug: `totalExpected` do planejado incluía parcelas já `replacedByRealCr`, somadas ao CR real.  
Correção: `applicableExpected = totalExpected − replacedAmount` e `computeConsolidatedFinancialSummary` usa só o aplicável → total = R$ 4.104,19.

## Impostos no banco

`NomusNfe` persiste: `xmlVProd`, `xmlVDesc`, `xmlVNF`, `valorLiquido`.  
**Não** há colunas dedicadas IPI/ICMS/ICMS-ST/FCP/PIS/COFINS. A UI mostra o agregado “Impostos destacados” e impostos de item quando o payload da linha traz `vTotTrib` / similares.

## Módulo compartilhado

`src/lib/sales/orderFiscalFinancialMetrics.ts` — DTO/helpers usados pelo relatório (tela/PDF/XLSX) e alinhados à Auditoria 360º.
