# APIs — Central de Tesouraria

**Prefixo:** `/api/finance/treasury`  
**Registro:** `src/lib/treasury/treasuryRoutes.ts`  
**Auth:** sessão (`requireAppAuth`) + flag mestra + `requireResource` (exceto `/health`, que exige auth e responde fail-closed pela flag).

Money nos payloads: **string decimal**. Datas civis: `YYYY-MM-DD`.

## 1. Plataforma

| Método | Path | Permissão |
|--------|------|-----------|
| GET | `/availability` | `finance.treasury` `view` |
| GET | `/health` | autenticado; `ok:false`/503 se módulo off |

## 2. Dashboard, alertas, previsto×realizado, auditoria

| Método | Path | Permissão |
|--------|------|-----------|
| GET | `/dashboard` | `finance.treasury.dashboard` `view` |
| GET | `/forecast-vs-actual` | dashboard `view` |
| GET | `/alerts` | dashboard `view` |
| GET/PUT | `/alert-settings` | view / exceptions `manage` |
| GET | `/audit` | `finance.treasury.audit` `view` |

## 3. Contas e saldos

| Método | Path | Permissão |
|--------|------|-----------|
| GET/POST | `/accounts` | view / manage |
| GET/PATCH | `/accounts/:id` | view / manage |
| POST | `/accounts/:id/deactivate\|reactivate` | manage |
| GET/PUT | `/accounts/:id/access` | manage |
| GET | `/accounts/:id/balances` | accounts `view` |
| GET | `/accounts/:id/balances/latest` | accounts `view` |
| GET | `/accounts/:id/balance-position` | accounts `view` |
| POST | `/accounts/:id/balance-snapshots` | balances `manage` (+ Idempotency-Key) |

## 4. Contas a receber (facade + overlays)

Também exige `finance.accounts_receivable` `view` nas leituras.

| Método | Path | Permissão Tesouraria |
|--------|------|----------------------|
| GET | `/receivables` | receivables `view` |
| GET | `/receivables/:titleId` | view |
| GET | `/receivables/:titleId/customer-summary` | view |
| PUT | `/receivables/:titleId/expectation` | receivables `manage` |
| GET/POST | `/receivables/:titleId/promises` | view / promise `execute` |
| POST | `/promises/:promiseId/cancel\|mark-fulfilled` | promise `execute` |
| GET/POST | `/receivables/:titleId/collection-actions` | view / collection `execute` |
| POST | `/collection-actions/:actionId/cancel` | collection `execute` |
| GET/POST | `/receivables/:titleId/disputes` | view / receivables `manage` |
| PATCH | `/disputes/:disputeId` | receivables `manage` |

## 5. Contas a pagar e programação

Também exige `finance.accounts_payable` `view` nas leituras.

| Método | Path | Permissão |
|--------|------|-----------|
| GET | `/payables` | payables `view` |
| GET | `/payables/:titleId` | view |
| GET | `/payment-schedule` | payables `view` |
| POST/PUT | `/payables/:titleId/program-payment` | payables.program `execute` |
| POST | `/payables/:titleId/program-payment/cancel` | execute |
| POST | `/payables/:titleId/hold\|release-hold` | execute |

Flag: `treasury.payablesProgramming.enabled`.

## 6. Projeção e agenda

Flag: `treasury.projection.enabled`.

| Método | Path | Permissão |
|--------|------|-----------|
| POST | `/projections/calculate` | dashboard `view` |
| GET | `/projections/latest` | dashboard `view` |
| GET | `/projections/compare` | dashboard `view` |
| GET | `/projections/:id` | dashboard `view` |
| GET | `/projections/:id/composition` | dashboard `view` |
| GET | `/agenda` | agenda `view` |

Horizonte máximo: `TREASURY_PROJECTION_MAX_HORIZON_DAYS` (default 90).

## 7. Transferências

Flag: `treasury.transfers.enabled`.

| Método | Path | Permissão |
|--------|------|-----------|
| GET/POST | `/transfers` | view / manage |
| GET | `/transfers/:id` | view |
| POST | `/transfers/:id/schedule\|send\|receive\|reconcile\|cancel` | manage |

## 8. Lançamentos manuais

| Método | Path | Permissão |
|--------|------|-----------|
| GET/POST | `/ledger-entries` | manual_entries view / manage |
| GET | `/ledger-entries/:id` | view |
| POST | `/ledger-entries/:id/reverse` | manage |

## 9. Exceções

Flag: `treasury.exceptions.enabled`.

| Método | Path | Permissão |
|--------|------|-----------|
| GET | `/exceptions` | view |
| GET | `/exceptions/:id` | view |
| POST | `/exceptions/:id/acknowledge\|assign\|due-at\|status\|resolve\|ignore\|cancel` | manage |

## 10. Fechamento diário

Flag: `treasury.dailyClosing.enabled`.

| Método | Path | Permissão |
|--------|------|-----------|
| GET | `/daily-closing/preview` | closing `view` |
| GET/POST | `/daily-closing` | view / `close` |
| GET | `/daily-closing/:id` | view |
| POST | `/daily-closing/:id/reopen` | `reopen` |

## 11. OFX, movimentos e conciliação

Flags: `treasury.ofxImport.enabled` (preview/apply), `treasury.reconciliation.enabled` (demais).

| Método | Path | Permissão |
|--------|------|-----------|
| POST | `/bank-imports/ofx/preview` | reconciliation `manage` |
| POST | `/bank-imports/ofx/apply` | reconciliation `manage` |
| GET | `/bank-imports` | view |
| GET | `/bank-movements` | view |
| GET | `/bank-movements/:id` | view |
| GET | `/reconcile/workspace` | view |
| GET | `/reconciliations` | view (`bankMovementId` query) |
| GET | `/reconciliations/:id` | view |
| POST | `/reconciliations` | manage (accept) |
| POST | `/reconciliations/:id/unmatch` | manage |
| POST | `/reconciliations/:id/reverse` | reconciliation.reverse `execute` (frase `REVERTER`) |

## 12. Relatórios e exportações

| Método | Path | Permissão |
|--------|------|-----------|
| GET | `/reports/:reportKey` | reports `view` |
| GET | `/reports/:reportKey/export.csv\|xlsx\|pdf` | reports `view` + `finance.treasury` `export` |

## 13. Erros

Respostas tipadas com `code`, `error`, `requestId` (`x-request-id`).  
Códigos comuns: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`, `DAY_CLOSED`.

## 14. Rate limit

Ações críticas (OFX preview/apply, reverse conciliação, close/reopen, export) passam por `requireTreasuryCriticalRateLimit`.
