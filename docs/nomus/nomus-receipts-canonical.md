# AR / Recebimentos — arquitetura canônica

> Referenciado por `src/lib/financeReceiptsCanonical.ts`. Este documento é a
> referência completa do modelo de três eixos e da camada canônica neutra de
> recebimentos financeiros — Financeiro, Tesouraria, Metas e Comissões.

## Regra mestra

> Um fato financeiro real entra uma vez no canônico e todos os consumidores
> relevantes derivam dele.

Para recebimento real (dinheiro que entrou):

```
Nomus GET /rest/recebimentos
  → mapper único (src/lib/nomus/nomusReceivableReceiptMapper.ts)
  → persistência NomusReceivableReceipt (identidade: externalId)
  → camada canônica financeira neutra (src/lib/financeReceiptsCanonical.ts / .server.ts)
  → consumidores (AR, Tesouraria, Metas, Comissões, Cash Flow, Executive Report)
```

Nenhum domínio consumidor deve reimplementar sua própria interpretação de
`receiptDate`, `receivedAmount`, `settlementDate` ou `amountReceived`. Acesso
direto a `NomusReceivableReceipt` fora do sync/mapper/camada canônica é
duplicação da regra, não uma segunda fonte de verdade.

## As cinco datas — nunca confundir

| Campo | Tabela | Significado | Nunca usar para |
|---|---|---|---|
| `dueDate` | `NomusAccountsReceivable` | Vencimento contratual — âncora da carteira/coorte e da previsão | Caixa realizado |
| `settlementDate` | `NomusAccountsReceivable` | **Baixa administrativa** no ERP (`dataBaixa`) — processo/auditoria | Competência de caixa |
| `amountReceived` | `NomusAccountsReceivable` | **Estado acumulado** do título (conferência, saldo, "quitado?") | "Quanto entrou num mês específico" quando existem receipts para o título |
| `receiptDate` | `NomusReceivableReceipt` | Dia civil em que o dinheiro **efetivamente entrou** (`dataRecebimento`) | — é a ÚNICA fonte de caixa real |
| `receivedAmount` | `NomusReceivableReceipt` | Valor do evento de recebimento — pode ser parcial | Confundir com o acumulado do título |
| `createdAtNomus` | `NomusReceivableReceipt` | Quando o registro de recebimento foi **criado no Nomus** — pode ser dias depois do `receiptDate`, com `receiptDate` retroativo | Competência de caixa, cursor de sincronização |
| `modifiedAtNomus` | `NomusReceivableReceipt` | Quando o registro foi **alterado no Nomus** pela última vez | Competência de caixa |

**`receiptDate` pode ser retroativo.** Caso real, comprovado em produção
(10/09/2026): recebimento `externalId` 11522, título (`receivableExternalId`)
19497 — `receiptDate` 04/09/2026, `receivedAmount` R$1.488,00,
`closesReceivable` true, mas `createdAtNomus`/`modifiedAtNomus` **10/09/2026
12:13:00Z**. O dinheiro entrou em 04/09; o Nomus só criou o registro em
10/09; a baixa (`settlementDate` do título) também saiu em 10/09. As três
datas divergem e cada uma mede uma coisa diferente — nenhuma pode substituir
outra.

Isso também prova que **`receiptDate` não é cursor confiável de
sincronização**: um full scan feito às 03:50 pode não conter um recebimento
cujo `receiptDate` é de dias atrás, porque o registro só passou a existir no
Nomus depois da varredura. Ver "Sincronização" abaixo.

## Proibido

- `receiptDate ?? settlementDate` (ou o inverso) em qualquer forma.
- Usar `NomusAccountsReceivable.amountReceived` como "recebido no mês" —
  válido apenas como estado acumulado do título.
- Usar `settlementDate` como competência de caixa.
- Consumidor de fora do sync/mapper/camada canônica montando `findMany`/
  `groupBy` direto contra `NomusReceivableReceipt`.
- Marcar um refresh parcial (`--maxPages` limitado) como full scan / prova de
  cobertura completa.

## Camada canônica neutra

`src/lib/financeReceiptsCanonical.ts` (lógica pura) +
`src/lib/financeReceiptsCanonical.server.ts` (Prisma, em lote — nunca uma
query por título). Oito primitivas:

1. `listReceiptEventsInPeriod` — eventos reais do período.
2. `sumReceivedAmountInPeriod` — soma real recebida no período (CAIXA).
3. `listReceiptEventsByReceivable(s)` — eventos por título (histórico completo).
4. `sumReceivedAmountByReceivables` — soma acumulada de receipts por título
   (conferência contra `amountReceived`, nunca competência de mês).
5. `loadReceivableIdsWithAnyReceipt` — cobertura: título tem QUALQUER receipt?
6. `loadSettledWithoutReceiptReceivables` — títulos baixados sem nenhum
   receipt local (`SETTLED_WITHOUT_RECEIPT`) — nunca vira caixa fictício.
7. `resolveFinanceReceiptsFreshness` + `classifyFinanceReceiptsFreshness` —
   freshness do ledger local (`FRESH`/`STALE`/`UNKNOWN`), pela idade de
   `syncedAt` — nunca por `receiptDate`.
8. Composição financeira (`receivedAmount`, `lateFeeInterestAmount`,
   `discountAmount`, `bankFeeAmount`, `closesReceivable`) exposta diretamente
   em cada `FinanceReceiptEvent`.

Helpers de data civil: `resolveCivilMonthUtcBounds`, `resolveCivilYearUtcBounds`,
`resolveCivilRangeUtcBounds` (intervalo arbitrário), `civilDateStringToUtcMidnight`,
`isReceiptInCivilPeriod` — todos em UTC-meia-noite, nunca hora local, porque
`receiptDate` é coluna Postgres `DATE`.

## Matriz de consumidores

| Consumidor | Rótulo | Tipo semântico | Data/valor | Fonte | Alterado nesta missão? |
|---|---|---|---|---|---|
| AR Overview (KPI) | "Caixa recebido no mês" (novo) / "Baixado no mês" | CASH_RECEIPT / ADMIN_SETTLEMENT | receiptDate+receivedAmount / settlementDate+amountReceived | `financeReceiptsCanonical` (aditivo) / cards existentes | Sim — aditivo, sem remover nada |
| AR Empresas (tabela) | "Baixado mês" | ADMIN_SETTLEMENT | settlementDate+amountReceived | `receivedThisMonthAmount` (inalterado) | Sim — só rótulo |
| AR Títulos (badge status) | "Baixa: {data}" | ADMIN_SETTLEMENT | settlementDate | inalterado | Sim — só rótulo |
| AR Títulos (export XLSX) | "Data da baixa" | ADMIN_SETTLEMENT | settlementDate | inalterado | Sim — só rótulo (era "Data recebimento") |
| Metas — `AR_CASH_RECEIVED_TOTAL` (novo) | "Valor efetivamente recebido (caixa real)" | CASH_RECEIPT | receiptDate+receivedAmount | provider `AR_CASH_RECEIVED` → `sumReceivedAmountInPeriod` | Sim — nova métrica oficial (P2) |
| Metas — `AR_RECEIVED_TOTAL` | "Valor baixado (settlementDate) — não é caixa" | ADMIN_SETTLEMENT | settlementDate+amountReceived | motor curado genérico (inalterado) | Sim — só rótulo/descrição |
| Comissões — competência | (interno) | CASH_RECEIPT | receiptDate+receivedAmount | `commissionReceiptCompetence` (já correto) | Já correto; 1 função delega ao canônico |
| Comissões — 4 arquivos server (reconcile/visualAudit/reprocess/exclusionReprocess) | (interno, datas/cobertura) | CASH_RECEIPT | receiptDate | migrados para `listReceiptEventsInPeriod`/`listReceiptEventsByReceivables`/`loadReceivableIdsWithAnyReceipt` | Sim — mesma query, sem mudança de comportamento |
| Comissões — `resolveReceiptNfeExternalIds` | (interno) | CASH_RECEIPT | receiptDate (filtro parcial/aberto) | acesso direto documentado — canônico não cobre filtro parcial | Não migrado — documentado inline |
| Tesouraria — `receivableReceived` (motor único-de-dia) | "Recebido hoje" / drill-down | CASH_RECEIPT (com fallback ADMIN_SETTLEMENT+forecast) | receiptDate+receivedAmount por evento; fallback settlementDate+tolerância quando não há receipt | `buildTreasuryCaixaCanonicalDays` + `receiptsByReceivableExternalId` | Sim — prioridade a receipt real, fallback preservado |
| Tesouraria — `receivableDue` | "A receber hoje" | COORTE_DUE_DATE / FORECAST | dueDate+balanceReceivable | inalterado | Não — nunca usa receipt |
| Tesouraria — CP (`payablePaid`/`payableDue`) | "Pago hoje"/"A pagar hoje" | ADMIN_SETTLEMENT (âncora dueDate) | dueDate | inalterado | Não — fora de escopo (só AR) |
| Cash Flow — `AR_RECEIVED_YTD` | "Recebido oficial YTD" (contrato interno) | ADMIN_SETTLEMENT | settlementDate+amountReceived | `financeCashFlowArMetrics.ts` (já autodocumentado via `reason`) | Não — já rotulado honestamente no próprio contrato |
| Cash Flow — `RECEIVED_BY_DUE_IN_PERIOD` | "Recebido alocado por vencimento" | COORTE_DUE_DATE | dueDate+amountReceived | inalterado | Não — já distinto explicitamente do YTD oficial |
| Executive Report — KPI "Caixa recebido mês/YTD" (novo) | idem | CASH_RECEIPT | receiptDate+receivedAmount | `sumReceivedAmountInPeriod` (aditivo, no orquestrador) | Sim — aditivo |
| Executive Report — KPI "Baixado mês/YTD" | idem (era "Recebido mês/YTD") | ADMIN_SETTLEMENT | settlementDate+amountReceived | `sumOfficialArReceivedBySettlementInPeriod` (inalterado) | Sim — só rótulo |
| Executive Report — gráfico anual / PDF tabela mensal | "Recebido" (não alterado nesta missão) | ADMIN_SETTLEMENT (movement) / COORTE_DUE_DATE (planejado) | settlementDate / dueDate | `buildCashFlowAnnualComparison`, `buildExecutiveMonthlyTimeline` | Não — múltiplos eixos internos já documentados/testados como distintos; alto risco de regressão em ~10 arquivos de teste com valores numéricos travados |

## Sincronização

### Full scan diário (soberano, inalterado)

`scripts/nomusReceivableReceiptsSync.ts` via `runNomusReceivableReceiptsSync.sh`,
cron `50 3 * * *`. Página 1 até o fim real da paginação, `--require-full-scan`.
Prova de cobertura obrigatória — sem ela, `exit 1`. **Continua sendo a única
garantia de reconciliação completa.**

### Refresh recente (acelerador best-effort, novo)

`scripts/runNomusReceivableReceiptsRecentSync.sh` — reaproveita o MESMO
`nomusReceivableReceiptsSync.ts` (mesmo mapper, upsert, tabela, identidade,
cliente HTTP, retry/backoff), só limita `--maxPages`
(`NOMUS_RECEIPTS_RECENT_MAX_PAGES`, default 3) e omite `--require-full-scan`
de propósito. **Nunca prova cobertura completa** — best-effort de baixa
latência apenas. Usa o MESMO lock (`NOMUS_RECEIPTS_SYNC_LOCK_FILE`) do full
scan — nunca roda concorrente com ele.

Ver `docs/nomus/nomus-automatic-sync-routines.md` para o cron sugerido
(`15 7-20 * * *`, ainda não instalado) e a explicação completa de por que
"primeira página sempre traz o que é novo" é evidência observada nesta
instalação, não contrato documentado do endpoint.

### Estratégia de deploy do cron

Não existe gerador de cron versionado neste repositório — confirmado por
auditoria exaustiva (CI/CD, Docker, systemd, Ansible/Terraform, scripts de
deploy). Isso é convenção deliberada do projeto: Pedidos, CR/CP e Propostas
horário já passaram pelo mesmo ciclo (bloco de referência versionado em doc →
validação manual `preview` no servidor → instalação manual por humano →
status atualizado). Recebimentos (full scan + refresh recente) segue a mesma
convenção — ver a seção "Cron a instalar" em
`docs/nomus/nomus-automatic-sync-routines.md`.

## Freshness

`resolveFinanceReceiptsFreshness` + `classifyFinanceReceiptsFreshness`
(`FRESH`/`STALE`/`UNKNOWN`) classificam pela idade de `syncedAt` — nunca por
`receiptDate` (um recebimento pode ter `receiptDate` antigo e ter acabado de
ser sincronizado). Janela padrão: 26h (folga sobre o ciclo diário de 24h do
full scan, que é a única garantia — o refresh recente é só acelerador).

## R$563,54 e CR 19363 — auditoria de composição

`scripts/auditFinanceArReceivedDecomposition.ts` (lógica pura testada em
`src/lib/financeArReceivedDecomposition.ts`) decompõe, título a título, sem
tentar "fechar" a diferença:

- **(a)** `amountReceived − (amountReceivable − balanceReceivable)` —
  conferência interna do próprio CR, não depende de receipts.
- **(b)** `amountReceived − Σ receipt.receivedAmount` — conferência do
  acumulado do CR contra a soma real dos eventos sincronizados.

Uso: `npm run audit:finance:ar-received-decomposition -- --year 2026 --month 8`.
