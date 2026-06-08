# Relatório — Sync Nomus Contas a Receber (fundação)

Gerado para a fase inicial de integração read-only com a API Nomus de Contas a Receber no IndusCost.

## Objetivo

Persistir localmente (PostgreSQL) os títulos de **Contas a Receber** vindos do Nomus, com rastreabilidade (`rawPayload`, `payloadHash`), para uso futuro em:

- dashboard financeiro;
- cobrança e inadimplência;
- fluxo de caixa;
- comparação com faturamento/pedidos.

**Esta fase não inclui dashboard nem alterações em pedidos/faturamento.**

## Endpoint Nomus

| Item | Valor |
|------|--------|
| Recurso | `contasReceber` |
| URL | `{NOMUS_BASE_URL}contasReceber?pagina=N&tamanhoPagina=50` |
| Método | GET |
| Paginação | `pagina` (1-based); página com **menos de 50** registros encerra a leitura |
| Autenticação | `NOMUS_AUTH_HEADER_NAME` + `NOMUS_AUTH_HEADER_VALUE` e/ou `NOMUS_TOKEN` (Bearer) |

`NOMUS_BASE_URL` deve terminar em `/rest/` (sem duplicar `/rest/rest`).

## Tabela / model Prisma

**Model:** `NomusAccountsReceivable`

| Campo local | Campo API Nomus |
|-------------|-----------------|
| `externalId` | `id` (unique) |
| `classification` | `classificacao` |
| `type` | `tipo` |
| `status` | `status` (boolean) |
| `companyId` / `companyName` | `idEmpresa` / `nomeEmpresa` |
| `personId` / `personName` | `idPessoa` / `nomePessoa` |
| `personCnpj` | `cnpjPessoa` |
| `personPhone` | `telefonePessoa` |
| `bankAccountId` / `bankAccountName` | `idContaBancaria` / `nomeContaBancaria` |
| `paymentMethodId` / `paymentMethodName` | `idFormaPagamento` / `nomeFormaPagamento` |
| `dueDate` | `dataVencimento` |
| `competenceDate` | `dataCompetencia` |
| `scheduleDate` | `dataAgendamento` |
| `createdAtNomus` | `dataHoraCriacao` |
| `modifiedAtNomus` | `dataModificacao` |
| `settlementDate` | `dataBaixa` |
| `amountReceivable` | `valorReceber` |
| `amountScheduled` | `valorReceberAgendado` |
| `amountReceived` | `valorRecebido` |
| `balanceReceivable` | `saldoReceber` |
| `description` | `descricaoLancamento` |
| `comments` | `comentarios` |
| `sourceInvoiceId` | `idNfe` |
| `sourceInvoiceNumber` | `numeroNotaFiscalOrigem` |
| `suspendCollection` | `suspenderCobranca` |
| `lateFeePercent` | `percentualMultaPorAtrasoEmContasReceber` |
| `monthlyInterestRate` | `taxaMensalJuros` |
| `lateFeeCalculationType` | `tipoCalculoMultaPorAtrasoEmContasReceber` |
| `lateInterestType` | `tipoJurosAtrasoEmContasReceber` |
| `rawPayload` | payload JSON integral |
| `payloadHash` | SHA-256 do payload |
| `syncedAt` | timestamp da sync |

**Sem FK para `SalesOrder` nesta fase** — vínculo com pedidos/NF será analisado depois.

## Regras de parsing

- Moeda BR: `"4.252,80"` → `Decimal` (reutiliza `parseNomusPtBrNumber`).
- Data: `"29/07/2026"` → `Date` (meia-noite local).
- Data/hora: `"03/06/2026 15:10:55"` → `Date`.
- Boolean: `true`/`false` e strings comuns (`sim`/`nao`).
- Campos ausentes ou vazios → `null`.
- Valores zero são preservados (não viram `null`).

## Comandos

```bash
# Preview (não grava)
npm run sync:nomus:accounts-receivable:preview

# Apply (upsert no banco)
npm run sync:nomus:accounts-receivable:apply

# Opções
npx tsx scripts/nomusAccountsReceivableSync.ts preview --page 1
npx tsx scripts/nomusAccountsReceivableSync.ts preview --maxPages 5
npx tsx scripts/nomusAccountsReceivableSync.ts apply --startPage 1 --maxPages 10
```

## Regras de sync

- Upsert por `externalId`.
- `payloadHash` detecta alteração — registros iguais contam como **inalterados** (atualiza só `syncedAt`).
- **Não exclui** registros locais ausentes na API nesta fase.
- Limite de segurança: `--maxPages` (default 200).
- Filtros `--fromDueDate` / `--toDueDate`: **não implementados** (dependem de confirmação da API Nomus).

## Endpoint read-only local

`GET /api/nomus/accounts-receivable/summary`

Permissões: `reports.view`, `settings.nomus.view` ou `settings.view`.

Retorna totais: registros, em aberto, baixados, saldo, vencidos, próximos 30 dias, última sync.

## Limitações

- Sync full paginado (sem delta por data nesta fase).
- Sem conciliação automática com pedidos/NF.
- Sem cálculo financeiro além dos valores da API.
- Credenciais nunca são logadas.

## Próximos passos (dashboard financeiro)

1. Rodar `apply` em produção e validar amostra vs Nomus.
2. Mapear relação `idNfe` / `numeroNotaFiscalOrigem` ↔ `SalesOrder`.
3. Dashboard de inadimplência (vencidos, aging, carteira).
4. Comparativo faturamento (NF processada) vs contas a receber.
5. Filtros por empresa, cliente, forma de pagamento.
6. Sync incremental se a API suportar filtros por vencimento/modificação.
