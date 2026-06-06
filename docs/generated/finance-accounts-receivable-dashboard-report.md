# Financeiro — Dashboard Contas a Receber

Relatório das fases **FINANCE-AR-DASH-A** … **FINANCE-AR-DASH-E** (polimento executivo e validação final).

## Objetivo

Domínio **Financeiro** no IndusCost com dashboard read-only de Contas a Receber, consumindo o stage local `NomusAccountsReceivable` (sync Nomus validado, sem alteração nestas fases).

**Fora de escopo:** baixa, cobrança, conciliação, edição, alteração do sync Nomus.

## Como acessar a tela

1. Menu lateral: **Financeiro**
2. Subaba: **Contas a Receber**
3. URL: `/finance/accounts-receivable`

Permissões de visualização: `finance.view` + `finance.accountsReceivable.view` (ou fallback `reports.view` / `settings.nomus.view` / `settings.view`).

Exportação CSV: `finance.accountsReceivable.export` (fallback: mesmas permissões de view — documentado abaixo).

Sync manual: `settings.nomus.sync` (mesmo critério do Admin Nomus).

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
- `dataQualitySummary` — alertas enriquecidos (FASE D): count, amount, severity
- `dataQualityAlerts` — contadores legados (+ overdue 30/60/90)

### Exportação CSV (FASE D)

`GET /api/finance/accounts-receivable/export`

Mesmos filtros do dashboard. Resposta `text/csv; charset=utf-8` com BOM (Excel pt-BR).

Nome sugerido: `contas-a-receber-YYYY-MM-DD.csv`

Colunas: ID Nomus, Empresa, Cliente, CNPJ, Descrição, NF origem, vencimento, baixa, valores, forma/conta, status calculado, dias atraso, cobrança suspensa, última sync.

Permissões: `finance.accountsReceivable.export` **ou** fallback `finance.accountsReceivable.view` / `finance.view` / `reports.view` / `settings.*`.

### Títulos (paginado)

`GET /api/finance/accounts-receivable/titles`

Mesmos filtros do dashboard, mais:

- `page`, `limit` (máx. 200, padrão 50)
- `sortBy`: `dueDate` | `balanceReceivable` | `externalId`
- `sortDirection`: `asc` | `desc`
- `search` — cliente, CNPJ, NF ou ID Nomus
- `overdueOnly` — `1` / `true`
- `qualityAlert` — filtro rápido a partir dos alertas de qualidade (FASE D)

Resposta: `{ page, limit, total, totalPages, sortBy, sortDirection, items[] }`.

## UI — FINANCE-AR-DASH-D

### Exportação

Botão **Exportar CSV** no cabeçalho — respeita filtros globais ativos.

### Alertas de qualidade

Bloco **Alertas de qualidade dos recebíveis** com:

| Alerta | Severidade típica |
|---|---|
| Sem CNPJ / sem vencimento / sem forma pag. | Atenção ou crítico |
| Saldo negativo / recebido > original | Crítico |
| Cobrança suspensa em aberto | Atenção |
| Sem NF vinculada | Info |
| Vencidos > 30 / 60 / 90 dias | Atenção → crítico |

Cada card: quantidade, valor envolvido (quando aplicável), severidade, link **Ver na tabela de títulos** (`qualityAlert`).

### Sync Nomus integrado

Painel compacto reutilizando:

- `GET /api/settings/nomus-sync/accounts-receivable-status`
- `POST /api/settings/nomus-sync/accounts-receivable-run`

Exibe status (SUCCESS, RUNNING, FAILED, STALE…), duração, lidos/criados/atualizados/inalterados/erros.

Botão **Rodar Contas a Receber agora** — confirmação `RODAR CONTAS A RECEBER NOMUS`, trata HTTP 409, polling enquanto RUNNING.

### UX

- **Atualizar dashboard** (recarrega agregados)
- **Dados atualizados em** (timestamp `generatedAt`)
- Empty states e erros por seção
- Sem NaN/null/undefined na UI

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
| `FinanceAccountsReceivableSyncPanel.tsx` | Status/sync Nomus + run manual |
| `FinanceAccountsReceivableDataQualityPanel.tsx` | Alertas de qualidade |
| `financeAccountsReceivableExport.ts` | Geração CSV server-side |
| `financeAccountsReceivableDataQuality.ts` | Regras e severidade de alertas |
| `financeAccountsReceivableSyncRun.ts` | Helper resposta 409 / duração |

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
npm run test:finance:accounts-receivable   # dashboard, format, actions, titles, export, quality, sync
npm run test:nomus:accounts-receivable
npm run lint
npm run build
```

Arquivos: `financeAccountsReceivableDashboard.test.ts`, `financeAccountsReceivableFormat.test.ts`, `financeAccountsReceivableActions.test.ts`, `financeAccountsReceivableTitles.test.ts`, `financeAccountsReceivableDataQuality.test.ts`, `financeAccountsReceivableExport.test.ts`, `financeAccountsReceivableSyncRun.test.ts`.

## Limitações

1. Cálculo em memória (~5,7k títulos OK; SQL agregado futuro).  
2. Export CSV carrega todos os títulos filtrados em memória no servidor.  
3. Sync manual reutiliza runner/cron existentes — não altera agendamento.  
4. Ranking de clientes carregado inteiro no dashboard (sem paginação dedicada).  
5. Sem export XLSX nesta fase (CSV com BOM para Excel).

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

Conferir: menu **Financeiro → Contas a Receber**, export CSV, alertas, sync manual, abas e títulos paginados.

## Próximos passos

- Filtros salvos e export XLSX  
- Paginação dedicada para ranking de clientes  
- Otimização SQL  
- Template `finance_controller` dedicado  

---

## FINANCE-AR-DASH-E — Status do módulo

**Status:** pronto para uso operacional read-only (v1).

### O que foi entregue (fases A–E)

| Área | Entrega |
|---|---|
| Backend | Dashboard agregado, títulos paginados, export CSV, alertas de qualidade |
| UI | 7 abas, 9 KPIs, 4 gráficos, filtros globais com debounce, sync/status Nomus |
| Operacional | Export CSV filtrado, alertas com drill-down para títulos, ação sugerida por cliente |
| Qualidade | Testes automatizados, formatadores seguros, permissões documentadas |

### Fora de escopo (não implementado)

- Baixa manual/automática, cobrança ativa, conciliação, régua de cobrança  
- Alteração de sync Nomus, cron ou runner  
- Edição de títulos ou clientes  

### Roadmap futuro (somente documentado)

1. Conciliação Faturado x Recebido  
2. Cruzamento com SalesOrder/NF  
3. Cobrança ativa por cliente  
4. Histórico de contatos de cobrança  
5. Baixa manual/automática  
6. Régua de cobrança  
7. Previsão de caixa integrada  
8. Inadimplência por vendedor  
9. Inadimplência por segmento/cliente  
10. Filtros incrementais reais da API Nomus, se existirem  

### Endpoints

| Método | Rota | Uso |
|---|---|---|
| GET | `/api/finance/accounts-receivable/dashboard` | KPIs, gráficos, alertas |
| GET | `/api/finance/accounts-receivable/titles` | Tabela paginada (50/página) |
| GET | `/api/finance/accounts-receivable/export` | CSV filtrado |
| GET | `/api/settings/nomus-sync/accounts-receivable-status` | Status sync |
| POST | `/api/settings/nomus-sync/accounts-receivable-run` | Sync manual |

### Permissões

| Ação | Permissão |
|---|---|
| Ver dashboard | `finance.accountsReceivable.view` (+ fallbacks documentados) |
| Exportar CSV | `finance.accountsReceivable.export` ou fallback view |
| Rodar sync | `settings.nomus.sync` |

Helpers: `src/lib/financeAccountsReceivablePermissions.ts`

### Comandos úteis

```bash
npm run test:finance:accounts-receivable
npm run test:nomus:accounts-receivable
npm run lint
npm run build
npx prisma validate
```

### Checklist de validação no servidor

```bash
cd /opt/induscost
git pull origin main
npm ci
npx prisma validate
npm run test:finance:accounts-receivable
npm run test:nomus:accounts-receivable
npm run build
sudo systemctl restart induscost
```

**Conferir manualmente:**

1. Menu **Financeiro → Contas a Receber** em desktop e mobile  
2. KPIs formatados (BRL, %, inteiros) — sem NaN/null  
3. Filtros com debounce; export CSV respeita filtros  
4. Aba Títulos paginada (50 linhas), scroll vertical em tabelas  
5. Alertas de qualidade → link abre títulos filtrados  
6. Sync: status visível; botão só com `settings.nomus.sync`; 409 se já rodando  
7. Falha de sync não derruba dashboard; falha de export mostra banner isolado  

### Polimento E (UX/performance)

- Cabeçalho gerencial, abas com scroll horizontal em mobile  
- Tabelas com altura máxima `min(70vh, 640px)` e cabeçalho sticky  
- Erros separados: dashboard / export / títulos / sync  
- Dashboard mantém dados anteriores se refresh falhar  
- Títulos: paginação server-side (não carrega ~5718 de uma vez)  
- Permissão de sync alinhada ao Admin (`settings.nomus.sync` apenas)  
