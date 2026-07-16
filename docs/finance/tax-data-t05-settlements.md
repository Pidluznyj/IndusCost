# T05 — Apuração, guias e recolhimentos fiscais

**Atualizado:** 2026-07-16  
**Status:** implementado (camadas B/C/D)  
**Base:** [tax-data-target-model.md](./tax-data-target-model.md), [tax-source-of-truth.md](./tax-source-of-truth.md)

## Fonte oficial do pago

| Situação | Fonte do `amountPaid` |
|----------|------------------------|
| Guia com `accountsPayableExternalId` | **`NomusAccountsPayable`** (espelho Nomus) — sync Contas a Pagar |
| Guia sem vínculo AP | `amountPaid` manual + `FiscalPaymentProof` (comprovante) |

Destacados da NF (camada A) **nunca** são presumidos como pagos.

## Integração com AP

- Não cria Contas a Pagar paralelo.
- Guia tipada (`FiscalPaymentGuide`) pode vincular `accountsPayableExternalId` = `NomusAccountsPayable.externalId`.
- Baixa / estorno / cancelamento ficam na guia; o espelho AP continua read-only via sync Nomus.

## Modelos

| Modelo | Camada |
|--------|--------|
| `FiscalApurationPeriod` + `FiscalApurationLine` | B — apurado |
| `FiscalPaymentGuide` + `FiscalPaymentProof` | C — recolhido |
| `FiscalAllocation` | D — alocação gerencial pedido/NF |
| `FiscalSettlementAuditLog` | auditoria |

Migration: `prisma/migrations/20260727120000_fiscal_apuration_guides_allocations/`

## UI

`Financeiro > Tributos` (`/taxes`):

1. **Apuração e guias** (novo)
2. **Regras de precificação** (`TaxRule` — inalterado)

## Permissões

- `finance.tax_apuration.view` / `.manage`
- `finance.tax_allocation.manage`
- View também aceita `taxes.view` (compatibilidade)

## API

- `/api/finance/fiscal-settlements/apurations`
- `/api/finance/fiscal-settlements/guides` (+ pay / cancel / reverse / proofs)
- `/api/finance/fiscal-settlements/allocations`

## Alocação gerencial

Sempre marcada `isManagerialOnly: true`. Métodos: `PRO_RATA_HIGHLIGHTED`, `DIRECT_GUIDE_NFE`, `MANUAL`.  
Nunca rotular como pagamento oficial da NF.
