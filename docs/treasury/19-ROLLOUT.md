# Rollout progressivo — Central de Tesouraria

**Código:** `treasuryFeatureFlags.ts`, `treasuryRollout.ts`, guards em `treasuryRoutes.ts`, filtro de abas em `TreasuryModule.tsx`.  
**Availability:** `GET /api/finance/treasury/availability` → `{ enabled, flags }`.

## Princípios

1. **Opt-in da mestra:** `TREASURY_MODULE_ENABLED` ausente = **OFF**. Ativar: `=1` / `true`.
2. **Subflags com mestra ON:** env ausente = ON; opt-out `0`/`false`/`off`/`no`.
3. **Fail-closed:** flag ID desconhecida = OFF; valor env desconhecido = OFF; mestra inválida = OFF.
4. **AND com a mestra:** toda subflag exige mestra ON.
5. **Flag OFF não apaga dados:** apenas bloqueia API (HTTP 404 `API route not found`) e oculta UI; registros Prisma permanecem.
6. **Rotas FE não quebram:** deep-link para submódulo OFF redireciona para o primeiro habilitado (ou mensagem de “nenhum submódulo liberado”).
7. **Permissão ≠ flag:** `requireResource` continua obrigatório; flag não concede acesso.

Ativação ADMIN/SUPER_ADMIN: [ACTIVATION.md](./ACTIVATION.md). Deploy sozinho **não** liga o módulo.

## Ordem recomendada de ativação

| # | Submódulo | Flag ID | Env |
|---|-----------|---------|-----|
| 1 | Base (mestra) | `treasury.enabled` | `TREASURY_MODULE_ENABLED` |
| 2 | Contas | `treasury.accounts.enabled` | `TREASURY_ACCOUNTS_ENABLED` |
| 3 | Saldos | `treasury.balances.enabled` | `TREASURY_BALANCES_ENABLED` |
| 4 | Dashboard | `treasury.dashboard.enabled` | `TREASURY_DASHBOARD_ENABLED` |
| 5 | AR (contas a receber) | `treasury.receivables.enabled` | `TREASURY_RECEIVABLES_ENABLED` |
| 6 | Promessas | `treasury.promises.enabled` | `TREASURY_PROMISES_ENABLED` |
| 7 | AP (contas a pagar) | `treasury.payables.enabled` | `TREASURY_PAYABLES_ENABLED` |
| 8 | Programação AP | `treasury.payablesProgramming.enabled` | `TREASURY_PAYABLES_PROGRAMMING_ENABLED` |
| 9 | Projeção / agenda | `treasury.projection.enabled` | `TREASURY_PROJECTION_ENABLED` |
| 10 | Transferências | `treasury.transfers.enabled` | `TREASURY_TRANSFERS_ENABLED` |
| 11 | Exceções | `treasury.exceptions.enabled` | `TREASURY_EXCEPTIONS_ENABLED` |
| 12 | OFX | `treasury.ofxImport.enabled` | `TREASURY_OFX_IMPORT_ENABLED` |
| 13 | Conciliação | `treasury.reconciliation.enabled` | `TREASURY_RECONCILIATION_ENABLED` |
| 14 | Fechamento diário | `treasury.dailyClosing.enabled` | `TREASURY_DAILY_CLOSING_ENABLED` |
| 15 | Relatórios | `treasury.reports.enabled` | `TREASURY_REPORTS_ENABLED` |

Constantes espelhadas em `TREASURY_ROLLOUT_ACTIVATION_ORDER`.

## Checklist operacional

1. Migrar schema e validar deploy (`validate:treasury:deploy`).
2. Ligar **somente** a mestra; confirmar nav + `GET /availability`.
3. Ativar contas → saldos → dashboard.
4. Liberar AR (+ promessas quando cobrança operacional estiver pronta).
5. Liberar AP (+ programação).
6. Liberar projeção/agenda após dados de conta/saldo/AR/AP mínimos.
7. Transferências / exceções conforme necessidade.
8. OFX → conciliação (nesta ordem).
9. Fechamento diário após conciliação estável.
10. Relatórios por último (consumidores agregados).
11. Conceder bags/resources aos papéis em paralelo às flags do escopo homologado.

**Homologação:** manter subflags OFF em produção até checklist do escopo OK (soft-launch).

## Comportamento com flag OFF

| Camada | Efeito |
|--------|--------|
| Backend | Middleware `requireTreasuryFeatureFlag` → 404 |
| Frontend | Aba oculta; rota aninhada redireciona |
| Dados | Preservados (sem delete/cascade por flag) |
| Auditoria UI | Permanece sob a mestra (`audit` sem subflag própria) |
