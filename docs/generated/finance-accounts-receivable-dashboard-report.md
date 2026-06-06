# Financeiro — Dashboard Contas a Receber

Relatório das fases **FINANCE-AR-DASH-A** (backend), **FINANCE-AR-DASH-B** (UI inicial) e **FINANCE-AR-DASH-C** (abas operacionais).

## Objetivo

Domínio **Financeiro** no IndusCost com dashboard read-only de Contas a Receber, consumindo o stage local `NomusAccountsReceivable` (sync Nomus validado, sem alteração nestas fases).

**Fora de escopo:** baixa, cobrança, conciliação, edição, alteração do sync Nomus.

## Como acessar a tela

1. Menu lateral: **Financeiro**
2. Subaba: **Contas a Receber**
3. URL: `/finance/accounts-receivable`

Permissões: `finance.view` + `finance.accountsReceivable.view` (ou fallback `reports.view` / `settings.nomus.view` / `settings.view`).

## Endpoints

### Dashboard (agregado)

`GET /api/finance/accounts-receivable/dashboard`

Query params opcionais (filtros globais da UI):

- `companyName`, `personName`, `personCnpj`
- `status`: `open` | `overdue` | `dueToday` | `upcoming` | `settled` | `suspended` | `all`
- `dueDateFrom`, `dueDateTo` (`YYYY-MM-DD`)
- `paymentMethodName`, `bankAccountName`

**Payload (campos principais):** `cards`, `agingBuckets`, `topDebtors`, `monthlyDueSchedule`, `criticalTitles`, `paymentMethodSummary`, `companySummary`, `dataQualityAlerts`, `generatedAt`.

**Novos blocos (FASE C, compatíveis com payload anterior):**

- `scheduleBuckets` — faixas Hoje, +7, +15, +30, +60, +90 dias (valor, títulos, clientes, top 3 clientes)
- `customerRanking` — ranking completo por cliente com `suggestedAction`
- `paymentMethodSummary[].averageTicket` — ticket médio por forma

### Títulos (paginado)

`GET /api/finance/accounts-receivable/titles`

Mesmos filtros do dashboard, mais:

- `page`, `limit` (máx. 200, padrão 50)
- `sortBy`: `dueDate` | `balanceReceivable` | `externalId`
- `sortDirection`: `asc` | `desc`
- `search` — cliente, CNPJ, NF ou ID Nomus
- `overdueOnly` — `1` / `true`

Resposta: `{ page, limit, total, totalPages, sortBy, sortDirection, items[] }`.

## UI — FINANCE-AR-DASH-C

### Abas internas

| Aba | Conteúdo |
|---|---|
| **Visão Geral** | KPIs, gráficos (aging resumido, top clientes, agenda mensal, formas pag.), títulos críticos |
| **Aging** | Tabela + gráfico por faixa (8 buckets) |
| **Agenda** | `scheduleBuckets` + tabela mensal |
| **Clientes** | Ranking com ação sugerida |
| **Títulos** | Tabela paginada via `/titles` (busca, ordenação, filtro atrasados) |
| **Formas de Pagamento** | Gráfico + tabela com ticket médio e inadimplência |
| **Empresas** | Resumo por `companyName` |

### Componentes

| Arquivo | Papel |
|---|---|
| `FinanceAccountsReceivablePage.tsx` | Shell: cabeçalho, filtros globais, tab bar |
| `FinanceAccountsReceivableTabPanels.tsx` | Painéis Visão Geral, Aging, Agenda, Clientes, Pagamento, Empresas |
| `FinanceAccountsReceivableTitlesTab.tsx` | Aba Títulos (endpoint paginado, loading/erro isolados) |
| `FinanceAccountsReceivableCharts.tsx` | Gráficos Recharts |
| `financeAccountsReceivableFormat.ts` | Formatadores moeda/percentual/data/status |
| `financeAccountsReceivableDashboardTypes.ts` | Tipos, `FINANCE_AR_TABS`, builders de query |
| `financeAccountsReceivableActions.ts` | Regras de ação sugerida por cliente |
| `financeAccountsReceivableTitles.ts` | Paginação/filtros de títulos |

### Ação sugerida (Clientes)

| Condição | Texto |
|---|---|
| Cobrança suspensa em aberto | Revisar motivo da cobrança suspensa |
| Sem atraso | Acompanhar |
| 1–7 dias | Lembrete leve |
| 8–15 dias | Cobrança ativa |
| 16–30 dias | Contato financeiro/comercial |
| 31+ dias | Escalonar |

### Regras visuais

- Moeda BRL (pt-BR), sem 6 casas decimais
- Datas `dd/mm/aaaa`
- Percentuais com `%`
- Valores inválidos exibidos como `—` (sem NaN/null/undefined)

### Resiliência

- Abas vazias: mensagem clara
- Erro na aba Títulos não derruba o dashboard
- Loading independente na aba Títulos

## Regras de cálculo (backend)

Referência: timezone local do servidor.

| Regra | Definição |
|---|---|
| Em aberto | `balanceReceivable > 0` |
| Baixado | `balanceReceivable <= 0` |
| Atrasado | aberto + `dueDate < hoje` |
| Vence hoje | aberto + `dueDate = hoje` |
| A vencer | aberto + `dueDate > hoje` |
| Inadimplência | `overdueAmount / totalOpenAmount` (0 se denominador 0) |

Ver `src/lib/financeAccountsReceivableDashboard.ts` para detalhes completos.

## Testes

```bash
npm run test:finance:accounts-receivable   # dashboard, format, actions, titles
npm run test:nomus:accounts-receivable
npm run lint
npm run build
```

Arquivos: `financeAccountsReceivableDashboard.test.ts`, `financeAccountsReceivableFormat.test.ts`, `financeAccountsReceivableActions.test.ts`, `financeAccountsReceivableTitles.test.ts`.

## Limitações

1. Cálculo em memória (~5,7k títulos OK; SQL agregado futuro).  
2. Sync manual não duplicado na tela — atalho para Admin.  
3. Estratégia sync no cabeçalho requer permissão de status Nomus.  
4. Sem export CSV/PDF nesta fase.  
5. Ranking de clientes carregado inteiro no dashboard (sem paginação dedicada).

## Validação no servidor

```bash
cd /opt/induscost
git pull origin main
npm ci
npx prisma validate
npm run test:finance:accounts-receivable
npm run build
sudo systemctl restart induscost
```

Conferir: menu **Financeiro → Contas a Receber**, abas, filtros globais, aba Títulos paginada.

## Próximos passos

- Paginação dedicada para ranking de clientes  
- Export e filtros salvos  
- Otimização SQL  
- Template `finance_controller` dedicado  
