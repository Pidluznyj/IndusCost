# Fonte oficial — Comercial > Comissões × Auditoria 360º (aba Comissões)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-14 |
| **Objetivo** | Uma língua só entre a tela principal de Comissões e o snapshot read-only da Auditoria 360º |

---

## 1. Fontes por tela

| Tela | Service / loader | Fonte oficial |
|------|------------------|---------------|
| **Comercial > Comissões** (Relatórios / Fechamento por recebimento) | `loadCommissionReceiptPreview` → `commissionReceiptEngine` → `CommissionReports` | `CommissionReceivableSchedule` materializado ligado a `CommissionOrderSnapshot` + baixas via CR (`settlementDate`) |
| **Auditoria 360º > aba Comissões** | `orderFullAuditService.loadCommissionBlock` | `CommissionOrderSnapshot` ACTIVE (+ itens / schedules) — **read-only**, sem recálculo |

---

## 2. Diferença que gerava `NO_MARGIN` com comissão na Auditoria

1. A listagem principal lê o **schedule por CR**. Se `scheduledCommissionAmount = 0` e os itens do snapshot tinham status `NO_COMMERCIAL_PRICE_TABLE` / `INVALID_COMMERCIAL_PRICE_RANGE`, o motor mapeava para **`NO_MARGIN`** e zerava a comissão na linha.
2. A Auditoria 360º lê **`CommissionOrderSnapshot.totalFinalCommissionAmount`** (e itens), independente da linha de fechamento por recebimento.
3. Quando o schedule ficava **stale/zerado** e o snapshot oficial ainda tinha comissão prevista, as telas divergiam em silêncio.

---

## 3. Regra de reconciliação (oficial)

1. Se `CommissionOrderSnapshot` (ou schedule ligado a ele) tem comissão prevista (`totalFinalCommissionAmount` / `finalCommissionAmount` / schedule > 0 com regra válida), a tela principal **deve refletir** esse valor.
2. **`NO_MARGIN`** só é válido quando o snapshot oficial também não tem base/margem/tabela/regra aplicável (comissão prevista = 0).
3. Schedule zerado + snapshot com comissão → status **`COMMISSION_SOURCE_MISMATCH`**, alerta `COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT`, origem `ORDER_SNAPSHOT`. Não marcar `NO_MARGIN`.
4. Comissão **já paga** não é alterada automaticamente — só sinalização + sugestão de reprocessar/materializar.
5. Auditoria 360º permanece read-only no snapshot.

---

## 4. Origens de linha (`source`)

| Valor | Uso |
|-------|-----|
| `ORDER_SNAPSHOT` | Listagem usando total do snapshot porque o schedule divergiu |
| `MATERIALIZED_SCHEDULE` / `RECEIVABLE_SCHEDULE` | Schedule materializado coerente |
| `RECEIPT_LEDGER` / `PERSISTED_LEDGER` | Ledger de fechamento fechado |
| `LEGACY_FALLBACK` / `CALCULATED` | Fallback legado (flag explícita) |
| `EXCEPTION` | Exceção sem schedule (diagnóstico) |

---

## 5. Eixo de período (tela principal)

- **Fechamento / Relatórios PAYABLE:** competência por **`settlementDate`** do CR (mês/ano do recebimento).
- **Snapshot do pedido:** data da venda / NF (`saleDate` / referência do motor) — não redefine o mês da listagem.
- **Previsão por CR:** vencimento / saldo em aberto.
- Pedido em Mai/2026 na tela de recebimento = baixa em maio, **não** necessariamente emissão em maio.

---

## 6. Vendedor canônico

Ambas as telas devem usar `CommissionPerson` + aliases (`resolveOrderCommissionSeller` / identidade canônica). A listagem não agrupa por ID cru Nomus na visão executiva.

---

## 7. O que fazer em divergência

1. Abrir Auditoria 360º do pedido (aba Comissões) — confirmar snapshot.
2. Reprocessar/materializar (`commissionReprocess` / rebuild schedule) **sem** tocar comissão paga.
3. Se persistir `COMMISSION_SOURCE_MISMATCH`, investigar schedule órfão / snapshot STALE / NF ambígua.

Scripts:

- `npx tsx tmp-audits/inspect-commission-main-vs-order-snapshot.ts`
- `npx tsx scripts/qaCommissionMainVsOrderSnapshot.ts`
