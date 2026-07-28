# Projeção e anti-dupla contagem

Código: `domain/treasuryProjectionEngine.ts`, `domain/treasuryMovementDateRules.ts`, `domain/treasuryFinancialIdentityRules.ts`, serviços de execução/fila.

## 1. Cenários

| Cenário | Uso |
|---------|-----|
| `CONTRACTUAL` | Vencimento oficial (`dueDate`) |
| `PROBABLE` | Promessa / expectativa / programação com fallback controlado |
| `CONFIRMED` | Datas confirmadas / realizadas / programação autorizada |
| `MANUAL` | Data manual explícita (não entra no enqueue default multi-cenário) |

## 2. Resolução de data de movimento

Dispatchers: `resolveReceivableMovementDate` / `resolvePayableMovementDate`.

### Contas a receber
| Cenário | Ordem resumida |
|---------|----------------|
| CONTRACTUAL | `dueDate` |
| PROBABLE | promessa ativa → `expectedDate` → `dueDate` não vencido; vencido sem overlay **não** vira “hoje” |
| CONFIRMED | `realizedDate` → `confirmedDate` |
| MANUAL | `manualDate` ou exclusão |

### Contas a pagar
| Cenário | Ordem resumida |
|---------|----------------|
| CONTRACTUAL | `dueDate` |
| PROBABLE | `scheduledDate` → `expectedDate` → `dueDate` |
| CONFIRMED | realização → schedule AUTHORIZED/PROGRAMMED → `confirmedDate` |
| MANUAL | `manualDate` ou exclusão |

Fuso: `America/Sao_Paulo`.

## 3. Anti-dupla contagem (identidade financeira)

Arquivo: `treasuryFinancialIdentityRules.ts`.

### Precedência de evidência de caixa (`TREASURY_FINANCIAL_PRECEDENCE`)
1. `RECONCILED_MOVEMENT`
2. `OFFICIAL_SETTLEMENT`
3. `REALIZED_UNRECONCILED`
4. `FORECAST`

### Fontes contextuais (nunca caixa bancário)
`TREASURY_NON_CASH_CLAIM_SOURCES`: `SALES_ORDER`, `NFE`, `OUTPUT_DOCUMENT` → `CONTEXTUAL_SUPPRESSED`.

### Transferências
- Entram na projeção de conta (`includeInCashProjection=true`).
- **Não** afetam consolidado (`affectsConsolidated=false`).

### Fluxo
`resolveTreasuryFinancialIdentities` → agrupamento por chave lógica → merge → escolha por precedência; perdedores `DUPLICATE_SUPPRESSED`.

Com realização + saldo aberto: previsão usa apenas saldo aberto; saldo zero suprime forecast.

## 4. Motor de projeção

- Determinístico; Decimal string / BigInt HALF_UP onde aplicável.
- Liquidez de aplicações: IMMEDIATE / D+1 / D+2 / D+3.
- Persistência: `TreasuryProjectionRun` + day lines + composition.
- Lock advisory por empresa+cenário na execução.
- Runs anteriores **não** são sobrescritos; “latest” = última válida.

## 5. Fila de recálculo (jobs)

Sem broker externo — tabela `TreasuryProjectionRecalcJob`.

**Eventos** (`TREASURY_PROJECTION_RECALC_EVENT_TYPES`):  
`AR_SYNC`, `AP_SYNC`, `SETTLEMENT`, `CANCELLATION`, `EXPECTATION`, `PROMISE`, `PROGRAMMING`, `LEDGER_ENTRY`, `TRANSFER`, `BALANCE`, `RECONCILIATION`, `REVERSAL`, `CLOSING`, `REOPENING`.

**Serviços:**
- Enqueue: `treasuryProjectionRecalcQueueService.server.ts` / `treasuryProjectionRecalc.server.ts`
- Worker: `runTreasuryProjectionRecalcWorker` (claim → process → succeed/retry/dead)
- Após sync Nomus: só em SUCCESS + payload completo + mudanças (`treasuryProjectionRecalcAfterNomusSync`)

Default multi-cenário: CONTRACTUAL / PROBABLE / CONFIRMED (MANUAL excluído do enqueue padrão).

## 6. APIs relacionadas

- `POST /projections/calculate`
- `GET /projections/latest|compare|:id|/composition`
- `GET /agenda`
- UI: `/finance/treasury/projections`, `/finance/treasury/agenda`
