# Adapter somente leitura — títulos oficiais Nomus (CR/CP)

**Prompt:** camada de adapters/repositories read-only  
**DTOs:** `OfficialReceivableView`, `OfficialPayableView`  
**Código:** `src/lib/treasury/adapters/treasuryOfficialTitlesAdapter*.ts`, `mappers/treasuryOfficialTitleMappers.ts`, `contracts/treasuryOfficialTitleContracts.ts`

## Objetivo

Expor projeção tipada dos models reais `NomusAccountsReceivable` e `NomusAccountsPayable` para a Tesouraria **sem criar cópia integral** dos títulos (sem upsert, sem tabela espelho).

## Mapeamento explícito

| Conceito pedido | AR (`NomusAccountsReceivable`) | AP (`NomusAccountsPayable`) | Campo no DTO |
|-----------------|--------------------------------|-----------------------------|--------------|
| ID interno | `id` (UUID) | `id` | `id` |
| externalId | `externalId` (Int Nomus) | `externalId` | `externalId` |
| Parcela | **sem coluna** | **sem coluna** | `installmentNumber` / `installmentLabel` (rawPayload / descrição) |
| Cliente / fornecedor | `personId`, `personName`, `personCnpj` | idem | `counterparty` (`role` CUSTOMER/SUPPLIER) |
| Documento | **sem** `documentNumber` tipado | `documentNumber` | `documentNumber` (AR sempre `null` nesta versão) |
| Pedido | **sem coluna** | **sem coluna** | `salesOrderExternalId` / `salesOrderCode` (rawPayload) |
| Nota fiscal | `sourceInvoiceId`, `sourceInvoiceNumber` | idem | `invoice` |
| Emissão | proxy: `competenceDate` | idem | `issuedOn` |
| Vencimento | `dueDate` | `dueDate` | `dueDate` |
| Valor original | `amountReceivable` | `amountPayable` | `originalAmount` (string decimal) |
| Saldo em aberto | `balanceReceivable` | `balancePayable` | `openBalance` |
| Baixas | `amountReceived` + `settlementDate` | `amountPaid` + `settlementDate` + `paymentDate` | `settlements` |
| Cancelamento | presença origem (`sourcePresenceStatus`, `sourceRemovedAt`) | idem | `cancellation` |
| Status oficial | `status` Boolean + flags derivadas | idem | `officialStatus` |
| Última sincronização | `syncedAt` | `syncedAt` | `lastSyncedAt` (ISO com offset) |

## Suposições

1. **Money** nos DTOs é sempre string decimal (`"4252.80"`), nunca `number`/Prisma.Decimal.
2. **Datas civis** (`issuedOn`, `dueDate`, baixas) usam `toCivilDateKey` (UTC date components), alinhado ao restante do financeiro.
3. **`issuedOn` ≈ `competenceDate`**: o stage local não tem “data de emissão da NF” tipada no título; competência é o melhor proxy documentado.
4. **Parcela e pedido** só entram se existirem no `rawPayload` Nomus (ou heurística `Parcela N` na descrição). Não há garantia de preenchimento.
5. **Pedido canônico** (`SalesOrder` via `SalesOrderNfeLink`) **não** é resolvido neste adapter — evita join/cópia implícita; fica para facade futura.
6. **Cancelamento** = removido/ausente na origem (`MISSING_CONFIRMED` ou `sourceRemovedAt`), **não** o boolean `status` de baixa.
7. **`isOpen`** = saldo em aberto > 0; **`isSettled`** = saldo ≤ 0 ou `status === true` (mesmo critério aproximado do summary AR existente).
8. Adapter é **fail-closed a escrita**: só `findUnique` / `findMany` / `count`.

## Divergências encontradas

| Tema | Divergência |
|------|-------------|
| Parcela | Pedido do programa assume parcela tipada; schema Nomus **não** persiste `installmentNumber`. |
| Pedido | Não há FK/`salesOrderId` no stage CR/CP; vínculo real costuma ser NF → `SalesOrderNfeLink`. |
| Documento AR | AP tem `documentNumber`; AR não — só descrição / NF origem. |
| Baixas | Não há entidade `Settlement`/`Baixa`; são colunas agregadas no título. |
| `status` Boolean | Nome sugere “status oficial”, mas na prática mistura liquidação; amostra de sync usa `status: false` com título em aberto. |
| Emissão vs competência | `dataCompetencia` Nomus pode ser mês/ano; não é data de emissão fiscal da NF. |
| Cliente/fornecedor | Denormalizados Nomus (`person*`); **sem** FK para `Customer` / `FinancialSupplier`. |
| Cancelamento de pedido | Exclusão gerencial por pedido cancelado (finance AR) **não** é campo do título — fica fora deste adapter. |
| AP valores negativos | Sync AP normaliza para positivo (`toOptionalPositiveDecimal`); o adapter lê o já persistido. |

## Não objetivos (explícito)

- Não criar tabela Tesouraria de títulos.
- Não `upsert` / `update` / `delete` em `NomusAccounts*`.
- Não substituir APIs `/api/finance/accounts-receivable|payable/*`.
- Não resolver overlays (promessa, contestação, programação) nesta etapa.

## Testes

- Fixtures fiéis ao shape do schema + `rawPayload` representativo (`src/lib/treasury/adapters/treasuryOfficialTitlesAdapter.test.ts`).
- Asserção de superfície read-only no fonte do adapter Prisma.
