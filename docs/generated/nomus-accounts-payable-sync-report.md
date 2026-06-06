# Relatório — Sync Nomus Contas a Pagar (fundação)

Gerado para a fase **NOMUS-AP-SYNC-A** de integração read-only com a API Nomus de Contas a Pagar no IndusCost.

## Objetivo

Persistir localmente (PostgreSQL) os títulos de **Contas a Pagar** vindos do Nomus, com rastreabilidade (`rawPayload`, `payloadHash`), para uso futuro em:

- dashboard financeiro de despesas;
- fluxo de caixa (saídas);
- aging de fornecedores;
- conciliação com NF de entrada.

**Esta fase não inclui dashboard, cron, botão Admin nem alterações em Contas a Receber.**

## Endpoint Nomus

| Item | Valor |
|------|--------|
| Recurso | `contasPagar` |
| URL | `{NOMUS_BASE_URL}contasPagar?pagina=N&tamanhoPagina=50` |
| Método | GET |
| Paginação | `pagina` (1-based); página com **menos de 50** registros encerra a leitura |
| Autenticação | `NOMUS_AUTH_HEADER_NAME` + `NOMUS_AUTH_HEADER_VALUE` e/ou `NOMUS_TOKEN` (Bearer) |
| Fallback envelope | `contas_pagar` |

`NOMUS_BASE_URL` deve terminar em `/rest/` (sem duplicar `/rest/rest`).

Referência diagnóstica: `docs/generated/nomus-accounts-payable-api-diagnostic.md`.

## Tabela / model Prisma

**Model:** `NomusAccountsPayable`

| Campo local | Campo API Nomus |
|-------------|-----------------|
| `externalId` | `id` (unique) |
| `classification` | `classificacao` |
| `type` | `tipo` |
| `status` | `status` (boolean) |
| `companyId` / `companyName` | `idEmpresa` / `nomeEmpresa` |
| `personId` / `personName` | `idPessoa` / `nomePessoa` (fornecedor) |
| `personCnpj` | `cnpjPessoa` / `cpfCnpj` |
| `personPhone` | `telefonePessoa` |
| `bankAccountId` / `bankAccountName` | `idContaBancaria` / `nomeContaBancaria` |
| `paymentMethodId` / `paymentMethodName` | `idFormaPagamento` / `nomeFormaPagamento` |
| `dueDate` | `dataVencimento` |
| `competenceDate` | `dataCompetencia` |
| `scheduleDate` | `dataAgendamento` |
| `createdAtNomus` | `dataHoraCriacao` |
| `modifiedAtNomus` | `dataModificacao` |
| `settlementDate` | `dataBaixa` |
| `paymentDate` | `dataPagamento` |
| `amountPayable` | `valorPagar` |
| `amountScheduled` | `valorPagarAgendado` |
| `amountPaid` | `valorPago` |
| `balancePayable` | `saldoPagar` |
| `description` | `descricaoLancamento` |
| `comments` | `comentarios` |
| `documentNumber` | `numeroDocumento` |
| `sourceInvoiceId` | `idNfe` |
| `sourceInvoiceNumber` | `numeroNotaFiscalOrigem` |
| `suspendPayment` | `suspenderPagamento` |
| `lateFeePercent` | `percentualMultaPorAtrasoEmContasPagar` |
| `monthlyInterestRate` | `taxaMensalJuros` |
| `lateFeeCalculationType` | `tipoCalculoMultaPorAtrasoEmContasPagar` |
| `lateInterestType` | `tipoJurosAtrasoEmContasPagar` |
| `rawPayload` | payload JSON integral |
| `payloadHash` | SHA-256 do payload |
| `syncedAt` | timestamp da sync |

## Regras de parsing

- Moeda BR: `"3.150,50"` → `Decimal` (reutiliza parser de Contas a Receber).
- Data: `"29/07/2026"` → `Date` (meia-noite local).
- Data/hora: `"03/06/2026 15:10:55"` → `Date`.
- Boolean: `true`/`false` e strings comuns.
- Campos ausentes ou vazios → `null`.

## Comandos

```bash
# Preview (não grava)
npm run sync:nomus:accounts-payable:preview

# Apply (upsert no banco)
npm run sync:nomus:accounts-payable:apply

# Opções
npx tsx scripts/nomusAccountsPayableSync.ts preview --page 1
npx tsx scripts/nomusAccountsPayableSync.ts preview --maxPages 5
npx tsx scripts/nomusAccountsPayableSync.ts apply --startPage 1 --maxPages 10
```

## Regras de sync

- Upsert por `externalId`.
- `payloadHash` detecta alteração — registros iguais contam como **inalterados** (atualiza só `syncedAt`).
- **Não exclui** registros locais ausentes na API nesta fase.
- Limite de segurança: `--maxPages` (default 200).
- Suporta `--page`, `--startPage`, `--maxPages`.

## Endpoint read-only local

`GET /api/nomus/accounts-payable/summary`

Permissões: `reports.view`, `settings.nomus.view` ou `settings.view`.

Retorna:

- `total`, `open`, `settled`
- `totalOpenAmount`, `overdueAmount`
- `dueNext7DaysAmount`, `dueNext30DaysAmount`
- `paidThisMonthAmount`, `lastSyncAt`

## Testes

```bash
npm run test:nomus:accounts-payable
```

Cobre parser, mapper, summary, paginação, URL sem `/rest/rest` e redação de credenciais.

## Limitações

- Sync full paginado (sem delta por data nesta fase).
- Sem conciliação automática com compras/NF.
- Credenciais nunca são logadas.

## Próximos passos (servidor)

1. `npx prisma migrate deploy`
2. `npm run sync:nomus:accounts-payable:preview`
3. Validar amostra vs Nomus
4. `npm run sync:nomus:accounts-payable:apply`
5. `GET /api/nomus/accounts-payable/summary` para conferir totais

## Próximos passos (produto)

1. Dashboard financeiro de Contas a Pagar.
2. Cron diário e botão Admin (fases futuras).
3. Conciliação com NF de entrada / fornecedores.
