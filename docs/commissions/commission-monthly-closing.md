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

## Detalhamento: Parcela e Status (2026-09-25)

- **Parcela** = `número/total` do título (CR) entre todos os CRs da mesma NF.
  - Número: `installmentNumber` já existente — gravado pelo scheduler
    (`loadReceivablesForNfe`: CRs com o mesmo `sourceInvoiceId`, ordem
    `dueDate ASC, externalId ASC`, posição + 1) ou persistido no ledger (CLOSED).
    Não é recalculado (também compõe a chave da linha do ledger).
  - Total: `installmentTotal`, preenchido no servidor por
    `enrichReceiptClosingPageInstallments` com duas consultas em lote a
    `NomusAccountsReceivable` (NF atual de cada CR; todos os CRs dessas NFs,
    recebidos ou não no mês). NF com 3 parcelas e 2 recebidas no mês: 1/3 e 2/3.
  - Só leitura: não grava schedule, ledger nem fechamento; PREVIEW e CLOSED usam a
    mesma regra; falha na leitura não derruba a tela.
  - Denominador seguro: o total só aparece quando a posição atual do CR na NF
    (mesma ordem do scheduler) é igual ao número gravado; senão a célula mostra
    `2/—`. Sem número (título sem schedule): `—`. Nunca `1/1` inventado.
  - XLSX (aba Analítico): coluna Parcela no mesmo formato; vazia sem número.
- **Status** = bolinha colorida com a mesma semântica do antigo badge (verde
  comissionável; cinza exclusões; âmbar pendências). Tooltip com o status por
  extenso (`COMMISSION_RECEIPT_LINE_STATUS_LABELS`) e o motivo, e
  `aria-label="Status: …"`. O tooltip da linha com o motivo continua.
- Tabela compacta, 12 colunas numa única `<table>`: valores sem quebra, colunas
  numéricas na largura do conteúdo e a sobra para Cliente/Vendedor. Cabe sem
  rolagem horizontal a partir de ~1.010 px de área útil (1366×768 com o menu
  aberto); em telas menores a rolagem horizontal continua disponível.

## Cobertura, cutover Nomus → IndusCost e pendências anteriores (2026-09-25)

- Competências até 09/2026: o Nomus é a fonte oficial — prévia disponível, apply e
  reprocesso bloqueados. O fechamento oficial no IndusCost começa em 10/2026.
- Cada evento de recebimento contemplado por um fechamento CLOSED ganha cobertura
  (`CommissionReceiptCoverage`, gravada na mesma transação do ledger); cancelamento e
  reprocesso a rebaixam para `SUPERSEDED`.
- Grid **Pendências de períodos anteriores** na prévia: recebimentos de competências
  anteriores ainda não cobertos podem ser incluídos no fechamento atual sem mudar o
  `receiptDate` (ledger guarda `naturalYear/naturalMonth` e `inclusionType`).
- Detalhes, estados, importação do Nomus, auditoria e troubleshooting:
  [commission-coverage-cutover.md](commission-coverage-cutover.md).
