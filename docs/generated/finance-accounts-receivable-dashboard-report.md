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

---

## Auditoria final FINANCE-AR-DASH-Z

**Data da auditoria:** 2026-06-06  
**Branch analisada:** `main`  
**Commit analisado:** `f286a7f` (`fix(finance): polish accounts receivable dashboard`)  
**Resultado:** aprovado — sem correções de código necessárias nesta fase.

### 1. Prisma / banco / models

| Item | Status |
|---|---|
| Model `NomusAccountsReceivable` | OK — `prisma/schema.prisma` |
| `npx prisma validate` | OK |
| Migration nova nesta fase | Não criada (usa stage existente do sync Nomus AR) |
| Fonte de dados do dashboard | `prisma.nomusAccountsReceivable.findMany` (read-only) |

**Campos no schema vs uso no dashboard:**

| Campo schema | Usado no select/query | Observação |
|---|---|---|
| externalId, companyName, personName, personCnpj | Sim | KPIs, filtros, tabelas |
| personPhone | Não | Existe no model; não exibido na v1 |
| dueDate, settlementDate | Sim | Aging, cards, filtros |
| amountReceivable, amountReceived, balanceReceivable | Sim | Decimal(20,2) → number no service |
| status | Sim | Mapeado como `nomusStatus` (boolean) |
| paymentMethodName, bankAccountName | Sim | Filtros e resumos |
| sourceInvoiceId, sourceInvoiceNumber | Sim | NF origem, alertas |
| suspendCollection | Sim | Status calculado + alertas |
| description | Sim | Títulos e export |
| syncedAt | Sim | Cards e export |
| rawPayload, payloadHash | Não | Deliberadamente excluídos (segurança) |

### 2. Endpoints backend

| Endpoint | Registrado | Auth | Read-only | Smoke (sem cookie) |
|---|---|---|---|---|
| GET `/api/finance/accounts-receivable/dashboard` | `financeAccountsReceivableRoutes.ts` + `server.ts:14439` | Sim | Sim | 401 |
| GET `/api/finance/accounts-receivable/titles` | Sim | Sim | Sim | 401 |
| GET `/api/finance/accounts-receivable/export` | Sim | Sim | Sim | 401 |
| GET `/api/settings/nomus-sync/accounts-receivable-status` | `server.ts:7600` | Sim | Sim | 401 |
| POST `/api/settings/nomus-sync/accounts-receivable-run` | `server.ts:7616` | Sim | Dispara runner existente | (não testado POST) |

Nenhum endpoint financeiro retorna `rawPayload`, tokens ou segredos.

### 3. Permissões efetivas

| Ação | Permissão |
|---|---|
| Ver dashboard / títulos | `finance.accountsReceivable.view` ou fallback: `finance.view`, `reports.view`, `settings.nomus.view`, `settings.view` |
| Exportar CSV | `finance.accountsReceivable.export` ou fallback view (documentado) |
| Rodar sync manual | `settings.nomus.sync` (UI e Admin alinhados) |

**Nota:** Não existe `finance.accountsReceivable.sync` — sync reutiliza permissão Nomus existente.

Helpers: `src/lib/financeAccountsReceivablePermissions.ts`

### 4. Regras de cálculo (validadas por testes)

- Em aberto: `balanceReceivable > 0`
- Baixado: `balanceReceivable <= 0` (inclui saldo zero; negativos geram alerta)
- Atrasado / vence hoje / a vencer: `startOfLocalDay` local (sem drift UTC)
- Próximos 7/30 dias: faixa inclusiva por dia local
- Recebido no mês: `settlementDate` no mês corrente
- Inadimplência: `overdueAmount / totalOpenAmount` → 0 se denominador 0
- Cliente: preferência `personCnpj`, fallback `personName`
- Payload: cards, agingBuckets, topDebtors, monthlyDueSchedule, paymentMethodSummary, companySummary, criticalTitles, dataQualityAlerts, dataQualitySummary, scheduleBuckets, customerRanking

### 5. Frontend / menu

- Menu lateral: **Financeiro** (`mainNavigation.ts`, `Sidebar.tsx`, `modulePermissions.ts`)
- Rota: `/finance/accounts-receivable` (`App.tsx` → `FinanceModule.tsx`)
- 7 abas: Visão Geral, Aging, Agenda, Clientes, Títulos, Formas de Pagamento, Empresas
- Export CSV, alertas de qualidade, painel sync/status integrados

### 6. Filtros

Query params: `companyName`, `personName`, `personCnpj`, `status`, `dueDateFrom`, `dueDateTo`, `paymentMethodName`, `bankAccountName`  
Debounce 400 ms nos campos textuais. Botão limpar filtros OK.  
Aba Títulos: `search`, `overdueOnly`, `qualityAlert`, paginação `page`/`limit`.

### 7. Exportação

- CSV com BOM (`;`), nome `contas-a-receber-YYYY-MM-DD.csv`
- 17 colunas conforme spec; sem `rawPayload`
- Respeita filtros globais; permissão aplicada

### 8. Performance

- Dashboard: agregação em memória (~5718 registros no servidor real)
- Títulos: paginação 50/página (máx. 200 no backend)
- Gráficos: dados agregados do payload dashboard
- Sem dependências novas pesadas (Recharts já existia)

### 9. Não regressão

Arquivos alterados nas fases A–E (ca18219…f286a7f): somente domínio Financeiro, permissões, menu, `server.ts` (registro de rotas financeiras).  
**Nenhuma alteração** em ProductBOM, custos, Dashboard Executivo, Pedidos, Faturamento, Frota, Clientes, RH.

### 10. Testes executados (Z)

| Comando | Resultado |
|---|---|
| `npx prisma validate` | OK |
| `npm run test:finance:accounts-receivable` | 47/47 pass |
| `npm run test:nomus:accounts-receivable` | 23/23 pass |
| `npm run test:nomus:daily-sync` | 16/16 pass |
| `npm run lint` | OK |
| `npm run build` | OK |

### 11. Smoke test local

Servidor dev em `http://0.0.0.0:3000` — rotas financeiras e status AR retornam **401** sem autenticação (não 404/500).

### 12. Limitações conhecidas (v1)

1. Cálculo dashboard/export em memória no Node  
2. Ranking de clientes completo no payload (sem paginação dedicada)  
3. `personPhone` não exibido  
4. Export CSV only (sem XLSX)  
5. Sync Nomus não alterado neste módulo — apenas consumo + disparo manual via endpoint existente

### 13. Roadmap futuro (não implementado)

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

---

## Filtro por ano e mês

**Fase:** FINANCE-AR-DASH-MONTH-YEAR-FILTER  
**Escopo:** Contas a Receber read-only — dashboard, títulos, exportação CSV.

### Parâmetros

| Query param | Tipo | Regra |
|---|---|---|
| `year` | número 4 dígitos (1000–9999) | Filtra títulos cujo `dueDate` cai no ano informado |
| `month` | 1–12 | Refina o filtro ao mês dentro do ano; **exige `year`** |

Exemplos:

- `GET /api/finance/accounts-receivable/dashboard?year=2026`
- `GET /api/finance/accounts-receivable/dashboard?year=2026&month=6`
- `GET /api/finance/accounts-receivable/titles?year=2026&month=6&page=1`
- `GET /api/finance/accounts-receivable/export?year=2026&month=6`

Valores inválidos retornam **400** com mensagem amigável (não 500). `NaN` não é aceito.

### Regra de vencimento (`dueDate`)

Intervalos calculados em **dia local** (`startOfLocalDay`), consistente com o restante do dashboard:

- **Ano:** `dueDate >= 1/jan 00:00` e `dueDate < 1/jan do ano seguinte`.
- **Ano + mês:** `dueDate >= 1º dia do mês 00:00` e `dueDate < 1º dia do mês seguinte`  
  (ex.: Jun/2026 → `>= 2026-06-01` e `< 2026-07-01`).

`dueDateFrom`/`dueDateTo` usam a mesma semântica half-open na interseção (`dueDateTo` inclusive = limite exclusivo no dia seguinte).

Títulos sem `dueDate` são excluídos quando há filtro de data ativo.

### Interação com `dueDateFrom` / `dueDateTo`

Quando `year`/`month` e `dueDateFrom`/`dueDateTo` são informados juntos, aplica-se a **interseção**:

- início efetivo = maior entre os inícios;
- fim efetivo = menor entre os fins.

Se a interseção for vazia, nenhum título é retornado.

### Mês sem ano

- **Backend:** retorna `400` — `"Informe o ano ao filtrar por mês."`
- **Frontend:** ao selecionar mês sem ano, preenche automaticamente o **ano corrente** antes de chamar a API (evita erro na UX).

### Impacto

Os filtros afetam todos os blocos derivados de `filterFinanceArRows`:

1. Cards/KPIs  
2. Aging  
3. Agenda (`scheduleBuckets`)  
4. Clientes (`customerRanking`, `topDebtors`)  
5. Títulos (`/titles`)  
6. Formas de pagamento  
7. Empresas  
8. Exportação CSV  
9. Gráficos e tabelas da tela  

O payload do dashboard inclui `filtersApplied` com `year`, `month`, `dueDateFrom`, `dueDateTo` quando aplicados.

### UI

Bloco **Período de vencimento** nos filtros globais (paridade BI), com:

- **Ano Vencimento** — select, opção “Todos” + anos recentes
- **Mês Vencimento** — select, opção “Todos” + meses em português
- **Vencimento de / até** — intervalo complementar

Campos de cliente, forma de pagamento e demais filtros ficam abaixo deste bloco. Botão **Limpar filtros** zera também ano e mês.

Filtros reservados (não implementados): Dia Vencimento, Status Baixa, NF Emitida? — ver `FinanceArUiFiltersFuture`.

### Testes executados (MONTH-YEAR-FILTER)

| Comando | Escopo |
|---|---|
| `npx prisma validate` | schema |
| `npm run test:finance:accounts-receivable` | parse, filter, query, titles, export |
| `npm run test:nomus:accounts-receivable` | regressão sync Nomus |
| `npm run lint` | ESLint |
| `npm run build` | TypeScript + Vite |
