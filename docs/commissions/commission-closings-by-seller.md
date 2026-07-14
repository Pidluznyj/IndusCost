# Fechamentos de Comissão (consulta por vendedor)

## Objetivo

Aba **Comercial > Comissões > Fechamentos** para consultar fechamentos **já gravados** no ledger oficial e abrir o relatório por **vendedor canônico**.

## Fonte oficial

- `CommissionMonthlyClosing` (status `CLOSED`, source `RECEIPT_BASED`)
- `CommissionReceiptLedgerLine`

**Não** recalcula comissão. **Não** usa prévia para relatório fechado.

## Fechamento geral × visão por vendedor

| Conceito | Descrição |
|----------|-----------|
| Fechamento mensal | Um por mês/ano (ex.: Junho/2026), com hash, totais e auditoria |
| Relatório por vendedor | Agrupa as linhas do ledger pelo vendedor canônico (`CommissionPerson`) |

Exclusões de cliente com vendedor atribuível entram na visão daquele vendedor (comissão zerada), para transparência da carteira.

## Como usar

1. Abrir `/commissions/fechamentos`
2. Filtrar ano/mês e buscar
3. **Ver** um fechamento → cards + grid Por vendedor
4. **Ver relatório** de um vendedor → cards + grid analítico executivo
5. **PDF** (padrão Pedido de Venda via `window.print`) ou **XLSX**

## Endpoints

- `GET /api/commissions/closings`
- `GET /api/commissions/closings/:closingId`
- `GET /api/commissions/closings/:closingId/sellers`
- `GET /api/commissions/closings/:closingId/sellers/:sellerKey`
- `GET /api/commissions/closings/:closingId/sellers/:sellerKey/xlsx`

PDF geral / XLSX geral reutilizam:

- `GET /api/commissions/receipt-closing/:year/:month/report`
- `GET /api/commissions/receipt-closing/:year/:month/report.xlsx`

## Permissão

Resource: `comissoes.tab.fechamentos` (+ legado `commissions.view`).

Escopo `own`: vendedor vê apenas o próprio relatório.

## Materialização

**Opção A (adotada):** derivação a partir do ledger — sem tabela nova.

## Validação

```bash
npx tsx scripts/qaCommissionClosingsBySeller.ts
npx tsx tmp-audits/inspect-commission-closings-by-seller.ts 2026 6
```
