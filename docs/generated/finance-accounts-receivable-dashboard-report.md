# Financeiro — Dashboard Contas a Receber (fundação)

Relatório da fase **FINANCE-AR-DASH-A**.

## Objetivo

Criar o domínio **Financeiro** no menu do IndusCost e o backend read-only do dashboard de Contas a Receber, consumindo o stage local `NomusAccountsReceivable` (sync Nomus já validado).

Esta fase **não** inclui:
- baixa, cobrança, conciliação ou edição;
- dashboard visual completo;
- alterações no sync Nomus.

## Menu / navegação

- Novo item lateral: **Financeiro** (`/finance`)
- Subitem interno: **Contas a Receber** (`/finance/accounts-receivable`)
- UI mínima de fundação com cards principais (próxima fase entrega layout completo)

## Endpoint

`GET /api/finance/accounts-receivable/dashboard`

Read-only. Retorna cards, aging, top devedores, cronograma mensal, formas de pagamento, empresas, títulos críticos e alertas de qualidade.

### Permissões (decisão)

Criadas permissões dedicadas no catálogo:

| Permissão | Uso |
|---|---|
| `finance.view` | Menu Financeiro |
| `finance.accountsReceivable.view` | Dashboard AR |

**Fallback na API e menu** (compatibilidade com perfis existentes):

- `reports.view`
- `settings.nomus.view`
- `settings.view`

Templates `admin` e `read_only` atualizados com as novas permissões financeiras.

## Regras de cálculo

Referência de data: **timezone local do servidor** (início/fim do dia via `Date` local).

| Regra | Definição |
|---|---|
| Em aberto | `balanceReceivable > 0` |
| Baixado | `balanceReceivable <= 0` |
| Atrasado | aberto + `dueDate < hoje` |
| Vence hoje | aberto + `dueDate = hoje` |
| A vencer | aberto + `dueDate > hoje` |
| Próx. 7/30 dias | aberto + vencimento entre hoje e hoje+N (inclusivo) |
| Recebido no mês | `settlementDate` no mês corrente → soma `amountReceived` |
| Inadimplência | `overdueAmount / totalOpenAmount` (0 se denominador 0) |
| Cliente distinto | `personCnpj` → senão `personName` → senão `externalId` |

Aging buckets (somente títulos em aberto com `dueDate`):

- A vencer, Vence hoje, 1–7, 8–15, 16–30, 31–60, 61–90, >90 dias vencidos

## Filtros (query params)

Todos opcionais:

- `companyName`, `personName`, `personCnpj`
- `status`: `open` | `overdue` | `dueToday` | `upcoming` | `settled` | `suspended` | `all`
- `dueDateFrom`, `dueDateTo` (ISO `YYYY-MM-DD`)
- `paymentMethodName`, `bankAccountName`

## Arquivos principais

| Arquivo | Papel |
|---|---|
| `src/lib/financeAccountsReceivableDashboard.ts` | Service de métricas |
| `src/lib/financeAccountsReceivableRoutes.ts` | Endpoint Express |
| `src/lib/financeAccountsReceivableDashboard.test.ts` | Testes unitários |
| `src/components/FinanceModule.tsx` | Shell do domínio + subnav |
| `src/components/finance/FinanceAccountsReceivableFoundationPanel.tsx` | UI mínima |
| `src/lib/modulePermissions.ts` | Acesso ao menu |
| `src/lib/permissionCatalog.ts` | Permissões `finance.*` |
| `src/App.tsx`, `Sidebar.tsx` | Rotas e menu |

## Limitações

1. Cálculo em memória sobre todos os registros (OK para ~5,7k títulos; otimizar com SQL agregado em fase futura).
2. Timezone depende do relógio local do servidor (esperado `/opt/induscost` em BRT).
3. UI completa (gráficos, filtros avançados, export) na próxima fase.

## Validação no servidor

```bash
cd /opt/induscost
git pull origin main
npm ci
npx prisma validate
npm run test:finance:accounts-receivable
npm run build
sudo systemctl restart induscost

# API autenticada
curl -s -b cookies.txt https://<host>/api/finance/accounts-receivable/dashboard | jq '.cards'
```

Conferir menu **Financeiro → Contas a Receber** no Admin/app autenticado.

## Próximos passos

- FINANCE-AR-DASH-B: UI completa (aging chart, top devedores, filtros, títulos críticos)
- Otimização SQL/índices se volume crescer
- Permissão dedicada `finance_controller` template (opcional)
