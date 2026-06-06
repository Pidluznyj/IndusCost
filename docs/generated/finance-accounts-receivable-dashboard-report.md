# Financeiro — Dashboard Contas a Receber

Relatório das fases **FINANCE-AR-DASH-A** (backend) e **FINANCE-AR-DASH-B** (UI).

## Objetivo

Domínio **Financeiro** no IndusCost com dashboard read-only de Contas a Receber, consumindo o stage local `NomusAccountsReceivable` (sync Nomus validado, sem alteração nestas fases).

**Fora de escopo:** baixa, cobrança, conciliação, edição, alteração do sync Nomus.

## Como acessar a tela

1. Menu lateral: **Financeiro**
2. Subaba: **Contas a Receber**
3. URL: `/finance/accounts-receivable`

Permissões: `finance.view` + `finance.accountsReceivable.view` (ou fallback `reports.view` / `settings.nomus.view` / `settings.view`).

## Endpoint

`GET /api/finance/accounts-receivable/dashboard`

Query params opcionais (mesmos filtros da UI):

- `companyName`, `personName`, `personCnpj`
- `status`: `open` | `overdue` | `dueToday` | `upcoming` | `settled` | `suspended` | `all`
- `dueDateFrom`, `dueDateTo` (`YYYY-MM-DD`)
- `paymentMethodName`, `bankAccountName`

## UI — FINANCE-AR-DASH-B

### Componentes

| Arquivo | Papel |
|---|---|
| `FinanceAccountsReceivablePage.tsx` | Tela principal (KPIs, filtros, gráficos, tabela) |
| `FinanceAccountsReceivableCharts.tsx` | Gráficos Recharts (aging, mensal, top devedores, pagamento) |
| `financeAccountsReceivableFormat.ts` | Formatadores moeda/percentual/data/status |
| `financeAccountsReceivableDashboardTypes.ts` | Tipos + builder de query string |
| `FinanceModule.tsx` | Subnav Financeiro |

### Cabeçalho

- Título, subtítulo, última sync, total de registros, estratégia sync (via status Nomus, se permitido)
- **Atualizar tela** — recarrega dashboard
- **Sync no Admin** — link para `/settings` (rotina manual permanece no Admin)

### Cards (9 KPIs)

1. Valor em aberto  
2. Valor vencido  
3. Valor a vencer  
4. Recebido no mês  
5. % inadimplência  
6. Títulos em aberto  
7. Clientes em atraso  
8. Vencendo em 7 dias  
9. Vencendo em 30 dias  

Cada card inclui hint com a regra de cálculo. Valores formatados em pt-BR (moeda compacta quando ≥ R$ 100 mil).

### Filtros

Empresa, Cliente, CNPJ, Status, período de vencimento (de/até), forma de pagamento, conta bancária.

- Busca textual com debounce 400 ms  
- Botão **Limpar filtros**  
- Recarrega o endpoint automaticamente  

### Gráficos (Recharts)

1. Aging de recebíveis (barras por faixa)  
2. Agenda mensal (stack vencido + a vencer)  
3. Top 10 clientes devedores (barras horizontais)  
4. Formas de pagamento (em aberto vs vencido)  

### Tabela títulos críticos

Até 20 registros do backend — colunas: ID Nomus, empresa, cliente, CNPJ, vencimento, saldo, forma pag., NF origem, status calculado, dias em atraso.

### Estados

Loading, erro, sem dados, dados carregados. Seções vazias não quebram a página.

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
npm run test:finance:accounts-receivable   # service + formatadores
npm run test:nomus:accounts-receivable
npm run lint
npm run build
```

## Limitações

1. Cálculo em memória (~5,7k títulos OK; SQL agregado futuro).  
2. Sync manual não duplicado na tela — atalho para Admin.  
3. Estratégia sync no cabeçalho requer permissão de status Nomus.  
4. Sem export CSV/PDF nesta fase.  
5. Sem drill-down por cliente/título individual além da tabela crítica.

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

Conferir: menu **Financeiro → Contas a Receber**, filtros, gráficos e tabela com dados reais (~5718 títulos).

## Próximos passos

- Drill-down por cliente / detalhe do título  
- Export e filtros salvos  
- Otimização SQL  
- Template `finance_controller` dedicado  
