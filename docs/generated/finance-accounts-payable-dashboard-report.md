# Financeiro — Dashboard Contas a Pagar

Relatório da fase **FINANCE-AP-DASH-A** (dashboard read-only v1).

## Objetivo

Domínio **Financeiro** no IndusCost com dashboard read-only de Contas a Pagar, consumindo o stage local `NomusAccountsPayable` (sync Nomus já existente, sem alteração nesta fase).

**Fora de escopo:** pagamento, baixa, edição, conciliação, alteração do sync Nomus, alteração de Contas a Receber.

## Como acessar a tela

1. Menu lateral: **Financeiro**
2. Subaba: **Contas a Pagar**
3. URL: `/finance/accounts-payable`

Permissões de visualização: `finance.accountsPayable.view` (fallback: `finance.view`, `reports.view`, `settings.nomus.view`, `settings.view`).

Exportação CSV: `finance.accountsPayable.export` (fallback: mesmas permissões de view).

Sync manual: `settings.nomus.sync` (endpoints Nomus existentes).

## Endpoints

### Dashboard (agregado)

`GET /api/finance/accounts-payable/dashboard`

Query params opcionais (filtros globais da UI):

- `year`, `month` — ano/mês de vencimento
- `companyName`, `personName`, `personCnpj`
- `status`: `open` | `overdue` | `dueToday` | `upcoming` | `settled` | `suspended` | `all`
- `dueDateFrom`, `dueDateTo` (`YYYY-MM-DD`)
- `paymentMethodName`, `bankAccountName`
- `documentQuery` — busca em documento/NF ou ID origem
- `suspendPayment`: `all` | `yes` | `no`

**Payload:** `cards`, `agingBuckets`, `topSuppliers`, `monthlyDueSchedule`, `scheduleBuckets`, `supplierRanking`, `paymentMethodSummary`, `companySummary`, `criticalTitles`, `dataQualityAlerts`, `dataQualitySummary`, `generatedAt`, `referenceDate`, `filtersApplied`.

### Títulos (paginado)

`GET /api/finance/accounts-payable/titles`

Mesmos filtros do dashboard, mais:

- `page`, `limit` (máx. 200, padrão 50)
- `sortBy`: `dueDate` | `balancePayable` | `externalId`
- `sortDirection`: `asc` | `desc`
- `search` — fornecedor, CNPJ, documento ou ID Nomus
- `overdueOnly` — `1` / `true`
- `qualityAlert` — filtro rápido a partir dos alertas de qualidade

### Exportação CSV

`GET /api/finance/accounts-payable/export`

Mesmos filtros do dashboard. Resposta `text/csv; charset=utf-8` com BOM (Excel pt-BR).

Nome: `contas-a-pagar-YYYY-MM-DD.csv`

Colunas: ID Nomus, Empresa, Fornecedor, CNPJ, Descrição, Documento/NF, vencimento, baixa/pagamento, valores, forma/conta, status calculado, status Nomus, dias atraso, pagamento suspenso, última sync. **Não exporta `rawPayload`.**

### Sync/status (reutilizado)

- `GET /api/settings/nomus-sync/accounts-payable-status`
- `POST /api/settings/nomus-sync/accounts-payable-run`

Confirmação manual: `RODAR CONTAS A PAGAR NOMUS`

## Regras de cálculo

| Conceito | Regra |
|----------|--------|
| Em aberto | `balancePayable > 0` |
| Pago/baixado | `balancePayable <= 0` |
| Atrasado | em aberto e `dueDate < hoje` |
| Vence hoje | em aberto e vencimento no dia corrente |
| A vencer | em aberto e `dueDate > hoje` |
| Pago no mês | `amountPaid` quando `paymentDate ?? settlementDate` no mês atual |
| % atraso | `overdueAmount / totalOpenAmount` (0 se denominador zero) |
| Fornecedor distinto | CNPJ preferencial, fallback nome, depois ID Nomus |

Valores monetários arredondados a 2 casas; percentuais com `%`; datas `dd/mm/aaaa`; nunca expor `NaN`, `Infinity` ou `undefined`.

**Sync Nomus (pós NOMUS-AP-LIVE-MAPPER-FIX):** a API `contasPagar` retorna campos `valorReceber`/`saldoReceber` com valores negativos; o mapper grava `balancePayable` e demais montantes como **positivos**. O dashboard assume valores positivos no stage local — rodar novo preview/apply no servidor após o fix antes de confiar nos KPIs.

## Cards (KPIs)

1. Valor total a pagar (`totalPayableAmount`)
2. Valor em aberto (`totalOpenAmount`)
3. Valor vencido (`overdueAmount`)
4. Valor a vencer (`upcomingAmount`)
5. Pago no mês (`paidThisMonthAmount`)
6. Vencendo hoje (`dueTodayAmount`)
7. Vencendo em 7 dias (`dueNext7DaysAmount`)
8. Vencendo em 30 dias (`dueNext30DaysAmount`)
9. Quantidade de títulos em aberto (`openTitlesCount`)
10. Fornecedores com atraso (`overdueSuppliersCount`)
11. % atraso sobre carteira em aberto (`overduePercent`)
12. Maior fornecedor credor (`topSupplier`)

## Abas da UI

1. Visão Geral
2. Aging
3. Agenda de Pagamentos
4. Fornecedores
5. Títulos
6. Formas de Pagamento
7. Empresas

### Aging

A vencer, Vence hoje, 1–7, 8–15, 16–30, 31–60, 61–90, Acima de 90 dias vencido.

### Agenda de pagamentos

Hoje, +7, +15, +30, +60, +90 dias e visão mensal.

### Ranking fornecedores

Fornecedor, CNPJ, totais em aberto/vencido/a vencer, quantidade de títulos, título mais antigo vencido, dias atraso máximo, % carteira, ação sugerida.

**Ações sugeridas:**

- Sem atraso → Programar pagamento
- 1–7 dias → Priorizar conferência
- 8–15 dias → Avaliar multa/juros
- 16–30 dias → Negociar fornecedor
- 31+ dias → Escalonar financeiro/diretoria
- Pagamento suspenso → Revisar bloqueio de pagamento

## Alertas de qualidade

Contadores e severidade para: vencimento ausente, CNPJ ausente, forma de pagamento ausente, saldo negativo, pago maior que original, pagamento suspenso em aberto, vencidos 30/60/90+ dias.

## Arquitetura (espelho AR)

| AR | AP |
|----|-----|
| `FinanceAccountsReceivablePage` | `FinanceAccountsPayablePage` |
| `financeAccountsReceivableDashboard` | `financeAccountsPayableDashboard` |
| `financeAccountsReceivableTitles` | `financeAccountsPayableTitles` |
| `financeAccountsReceivableExport` | `financeAccountsPayableExport` |
| `registerFinanceAccountsReceivableRoutes` | `registerFinanceAccountsPayableRoutes` |

Fonte Prisma: `nomusAccountsPayable`.

## Permissões

| Ação | Permissão |
|------|-----------|
| Ver dashboard/títulos | `finance.accountsPayable.view` (+ fallbacks) |
| Exportar CSV | `finance.accountsPayable.export` (+ fallbacks view) |
| Rodar sync manual | `settings.nomus.sync` |

Registradas em `permissionCatalog.ts` e `modulePermissions.ts`.

## Testes

```bash
npm run test:finance:accounts-payable
npm run test:nomus:accounts-payable
npm run test:finance:accounts-receivable
npx prisma validate
npm run lint
npm run build
```

Cobertura: cards, aging, filtros ano/mês, títulos paginados, export, data quality, permissões, sync run 409/202, formatação segura, ausência de NaN/Infinity.

## Próximos passos (servidor)

1. `git pull` na branch com este commit.
2. `npm ci` (se necessário).
3. `npx prisma validate` — schema já existente, sem migration nova nesta fase.
4. `npm run build` e reiniciar o processo Node/API.
5. Conferir permissões de usuários (`finance.accountsPayable.view` / `.export`).
6. Rodar sync Nomus Contas a Pagar se o stage local estiver vazio.
7. Acessar `/finance/accounts-payable` e validar KPIs com dados reais.

---

## Auditoria final FINANCE-AP-DASH-Z

**Data:** 2026-06-06  
**Branch:** `main`  
**Commit dashboard:** `0a1e0b3` (`feat(finance): add accounts payable dashboard`)  
**Commits sync (pré-requisito):** `61073e8`, `95d5d45`, `a02d297`

### Checklist de validação

| # | Item | Resultado |
|---|------|-----------|
| 1 | Model `NomusAccountsPayable` | OK — `prisma/schema.prisma` L1300–1365 |
| 2 | Campos usados no dashboard existem no Prisma | OK — select `FINANCE_AP_TITLE_SELECT` alinhado |
| 3 | Migration | OK — `20260607120000_nomus_accounts_payable/migration.sql` |
| 4 | Sync preview/apply | OK — `scripts/nomusAccountsPayableSync.ts` (modos dry/apply) |
| 5 | Runner/status/Admin | OK — `runNomusAccountsPayableSync.sh`, card Admin, endpoints status/run |
| 6 | Cron recomendado documentado | OK — `docs/generated/nomus-accounts-payable-sync-schedule-report.md` (a cada 2h) |
| 7 | Dashboard Financeiro > Contas a Pagar | OK — `FinanceModule` + `FinanceAccountsPayablePage` |
| 8 | Endpoints protegidos | OK — `requireAppAuth` + permissões; smoke 401 sem cookie |
| 9 | Export respeita filtros | OK — testes `financeAccountsPayableExport.test.ts` |
| 10 | Ano/Mês funcionam | OK — testes dashboard + titles |
| 11 | Títulos paginados | OK — `page`/`limit`/`sortBy`, máx. 200 |
| 12 | Sem NaN/Infinity/null exposto | OK — `safeFinanceNumber`, `roundMoney`, testes dedicados |
| 13 | Contas a Receber intacto | OK — zero arquivos `*Receivable*` alterados desde `61073e8` |
| 14 | Outros domínios intactos | OK — escopo limitado a finance AP + wiring |

### Rotas verificadas

| Rota | Registro | Auth smoke (sem cookie) |
|------|----------|-------------------------|
| `GET /api/nomus/accounts-payable/summary` | `nomusAccountsPayableRoutes.ts` | (não no smoke desta fase) |
| `GET /api/settings/nomus-sync/accounts-payable-status` | `server.ts` | **401** |
| `POST /api/settings/nomus-sync/accounts-payable-run` | `server.ts` | — |
| `GET /api/finance/accounts-payable/dashboard` | `financeAccountsPayableRoutes.ts` | **401** |
| `GET /api/finance/accounts-payable/titles` | `financeAccountsPayableRoutes.ts` | **401** |
| `GET /api/finance/accounts-payable/export` | `financeAccountsPayableRoutes.ts` | **401** |

Smoke local executado em `http://127.0.0.1:3099` (dev server).

### Campos Prisma consumidos pelo dashboard

`externalId`, `companyName`, `personName`, `personCnpj`, `description`, `dueDate`, `settlementDate`, `paymentDate`, `amountPayable`, `amountPaid`, `balancePayable`, `paymentMethodName`, `bankAccountName`, `sourceInvoiceId`, `documentNumber`, `suspendPayment`, `status` (→ `nomusStatus`), `syncedAt`.

Campos do model **não** usados no dashboard read-only: `rawPayload` (não exportado), `payloadHash`, campos de juros/multa, etc.

### Testes executados na auditoria

| Comando | Resultado |
|---------|-----------|
| `npx prisma validate` | OK |
| `npm run test:nomus:accounts-payable` | 27/27 |
| `npm run test:finance:accounts-payable` | 61/61 |
| `npm run test:nomus:accounts-receivable` | 23/23 |
| `npm run test:finance:accounts-receivable` | 72/72 |
| `npm run test:nomus:daily-sync` | 16/16 |
| `npm run lint` | OK |
| `npm run build` | OK |

### Problemas encontrados

1. **Baixa/Pagamento na aba Títulos** — coluna exibia só `settlementDate`, ignorando `paymentDate` (regra de negócio usa `paymentDate ?? settlementDate`).
2. **Cosmético** — descrições de teste com typo “atrasoência” (não afeta runtime).
3. **Cosmético** — aba Títulos mantém coluna “NF emitida” herdada do template AR (não bloqueia uso; spec AP prioriza Documento/NF).

### Correções aplicadas nesta auditoria

- Títulos: expor `paymentDate` no payload e exibir `paymentDate ?? settlementDate` na coluna Baixa/Pagamento.

### Conclusão

Módulo **Financeiro > Contas a Pagar v1 read-only** aprovado para deploy. Próximo passo operacional: pull no servidor, permissões e sync inicial se stage vazio.
