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

## 7. Timeline da Caixa — atraso recente (visibilidade, não caixa)

A regra financeira permanece: título vencido e não liquidado **não** entra em
fluxo, projeção, `inflows`, `outflows`, `opening`, `closing`, cenários nem
gráfico. O motor **não** move automaticamente o vencido para “hoje”, e o valor
**nunca** é tratado como recebido sem evidência de baixa.

Exceção **visual** controlada na Linha do tempo da aba Caixa
(`selectTreasuryCaixaRecentOverdueReceivables` / `recentOverdueReceivables`):

- CR **aberto** com **1 a 3 dias corridos** de atraso (`daysOverdue` do motor
  oficial de Contas a Receber) pode permanecer visível na Timeline, na **data
  original de vencimento**, como evidência operacional (“onde deveria ter
  acontecido”).
- Essa representação **não** compõe entradas, saídas ou saldo. Não é
  `TreasuryCaixaTimelineRow` financeiro — é uma camada paralela.
- A partir de **D+4** o título some dessa camada e fica **somente** no estoque
  de Atrasados.
- Durante D+1..D+3 o mesmo título pode aparecer nas duas dimensões: Timeline
  (vencimento recente) e Atrasados (pendência atual). Isso **não** é dupla
  contagem financeira.
- Dias corridos, inclusive fim de semana. **Não** confundir com a tolerância
  de 3 **dias úteis** de `financeSettlementReconciliation.ts` (data efetiva de
  baixa de título **já liquidado**).
