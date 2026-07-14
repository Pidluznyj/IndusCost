# Relatórios de comissão (fechamento)

## Consulta do fechamento

Comercial > Comissões > Fechamento por recebimento:

- ano/mês → **Carregar fechamento** → badge **FECHADO**;
- dados do ledger oficial (não prévia).

Endpoints:

- `GET /api/commissions/receipt-closing/:year/:month`
- `GET /api/commissions/receipt-closing/:year/:month/report` (somente CLOSED)

## Fechamentos (histórico)

Para consultar vários meses já fechados e o relatório **por vendedor**, use a aba
**Fechamentos** (`/commissions/fechamentos`). Ver `commission-closings-by-seller.md`.

## PDF

- Título: **COMERCIAL: RELATÓRIO DE COMISSÕES**
- Botão **Imprimir / PDF** na tela (mesmo padrão visual de Pedidos de Venda: `sales-order-report-print.css`).
- Resumo executivo + por vendedor + analítico.
- Valores monetários com `sales-orders-print-money` / `col-money` (sem quebra).

## XLSX

- Botão **Exportar detalhamento** / endpoint `…/export-detail.xlsx` ou `…/report.xlsx`
- Abas: **Resumo**, **Por vendedor**, **Analítico**
- Inclui status FECHADO, observação e divergências aceitas quando houver

## Relatório consolidado anual

`GET /api/commissions/reports` e `…/reports/export.xlsx` também preferem meses CLOSED do ledger quando existirem.
