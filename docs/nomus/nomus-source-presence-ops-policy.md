# SYNC-07 — Presença da origem nos consumidores operacionais

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | SYNC-07 |
| **Pré-requisitos** | SYNC-01…06 |
| **Atualizado** | 2026-07-17 |

---

## Checklist

| # | Pergunta | Decisão |
|---|----------|---------|
| 1 | Filtro central reutilizável? | **Sim** — `isNomusSourceOperationallyPresent` + merges Prisma/SQL |
| 2 | Consumidor precisa mostrar históricos ausentes? | **Sim** — auditoria, liquidados, detalhe por id, SUPER_ADMIN |
| 3 | Relatório com SQL próprio? | **Sim** — CRM portfolio + billing forecast usam fragmento SQL da policy |
| 4 | Frontend filtra presença? | **Não** — autoridade no backend |
| 5 | Feature flag? | **Sim** — flags independentes Pedidos / CR / CP (fail-closed) |

---

## Regra central

```
PRESENT            → operacional
MISSING_CANDIDATE  → operacional (+ alerta admin opcional)
MISSING_CONFIRMED  → fora das visões operacionais futuras
```

Histórico liquidado (`saldo <= 0`) com `MISSING_CONFIRMED` permanece acessível.
Não inferir ausência de CR/CP por Pedido (fontes independentes).

---

## Flags

| Env | Entidade |
|-----|----------|
| `NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENABLED` | Pedidos |
| `NOMUS_OPS_EXCLUDE_MISSING_AR_ENABLED` | Contas a Receber |
| `NOMUS_OPS_EXCLUDE_MISSING_AP_ENABLED` | Contas a Pagar |

Desligada: lifecycle continua; consumidores iguais ao pré-SYNC-07.
Ligada: `MISSING_CONFIRMED` sai das visões operacionais.

---

## Consumidores alterados

- AR/AP dashboards + horizon + freshness in-memory
- Fluxo de Caixa (via where oficial + select de presença)
- Gestão / métricas / portfolio / Kanban de Pedidos
- CRM SQL + previsão de faturamento SQL
- Comissão prevista (enrichment de Pedido)

## Preservados

- Syncers (não tocados)
- Auditoria / orphan audit / reconciliation preview
- Recebimentos/pagamentos históricos
- Comissões confirmadas/pagas
- Detalhe por id; `includeConfirmedMissing` para SUPER_ADMIN

---

## Código

| Peça | Path |
|------|------|
| Policy | `src/lib/nomus/nomusSourcePresencePolicy.ts` |
| Testes | `src/lib/nomus/nomusSourcePresencePolicy.test.ts` |
