# Fechamento mensal de comissões

## Fluxo

1. **Prévia** — `GET /api/commissions/receipt-closing/preview` calcula linhas sem gravar.
2. **Fechar** — `POST /api/commissions/receipt-closing/apply` com confirmação `FECHAR COMISSAO`.
3. **Consultar (operação)** — `GET /api/commissions/receipt-closing/:year/:month` ou botão **Carregar fechamento**.
4. **Consultar (histórico)** — aba **Fechamentos** (`/commissions/fechamentos`) lista CLOSED e abre relatório por vendedor. Ver `commission-closings-by-seller.md`.
5. **PDF** — na tela, **Imprimir / PDF** (`window.print` + documento institucional).
6. **XLSX** — `export-detail.xlsx` / `report.xlsx` (abas Resumo, Por vendedor, Analítico).

## Divergência crítica

Se a prévia exigir confirmação crítica:

- digitar `FECHAR COMISSAO`;
- digitar `DIVERGENCIA CRITICA`;
- informar observação;
- o aceite fica em `CommissionMonthlyClosing.notes` (`[CRITICAL_DIVERGENCE_ACCEPTED]`…).

Após confirmação válida, o fechamento **não** pode falhar por `ruleId`.

## ruleId / snapshot

- `CommissionReceiptLedgerLine.ruleId` → FK opcional para `CommissionRule`.
- Linhas de **cliente excluído** usam `customerExclusionRuleId` (não `ruleId`).
- Antes do `createMany`, `sanitizeLedgerLineRuleRefs` remove IDs inexistentes e preserva snapshot em `ruleSnapshotJson` / `ruleNameSnapshot`.
- Alerta técnico: `COMMISSION_RULE_SNAPSHOT_WITHOUT_ACTIVE_RULE`.

## Prévia × fechamento oficial

| Modo | Fonte |
|------|--------|
| PREVIEW | Motor de recebimento (recalculado) |
| CLOSED | `CommissionMonthlyClosing` + `CommissionReceiptLedgerLine` |

Com fechamento CLOSED, a tela lê o ledger; PDF/XLSX usam esses dados.
