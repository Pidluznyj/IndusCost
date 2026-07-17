# FIN-13 — Runbook: repair de agendas staged (entregas parciais)

| | |
|---|---|
| **Script** | `scripts/repairStagedDeliverySchedules.ts` |
| **Preview** | `npm run repair:staged-delivery-schedules:preview` |
| **Apply** | `npm run repair:staged-delivery-schedules:apply` |
| **Política** | `docs/finance/staged-delivery-schedule-remediation.md` |

O Cursor **não** executa apply no banco de produção.

---

## 1. O que o repair faz

| Modo | Efeito |
|---|---|
| **preview** | Lista pedidos elegíveis (`STAGED_AUTOMATIC` / orphan staged) e a agenda residual nova — **sem escrita** |
| **apply** | Para cada candidato, chama o rebuild oficial `OrderToCashAudit` **somente** daquele Pedido |

**Não altera:** SalesOrder, Documento de Saída, NF-e, `NomusAccountsReceivable`.

A agenda efetiva em telas (Detalhe / AR / Auditoria 360°) já usa o motor FIN-05 em tempo de leitura — o repair atualiza **fatos materializados** O2C.

---

## 2. Comandos

Piloto por Pedido:

```bash
npm run repair:staged-delivery-schedules:preview -- --order="PD 02596"
npm run repair:staged-delivery-schedules:apply -- --order="PD 02596"
```

Lote por período:

```bash
npm run repair:staged-delivery-schedules:preview -- --from=2025-01-01 --to=2026-12-31 --batch-size=50
npm run repair:staged-delivery-schedules:apply -- --from=2025-01-01 --to=2026-12-31 --batch-size=20
```

---

## 3. Lock e retomada

- Lock: `.locks/repair-staged-delivery-schedules.lock`
- Em caso de interrupção, remover o lock **somente** se o processo não estiver ativo
- Relançar o mesmo comando; pedidos já rebuildados são idempotentes no O2C

---

## 4. Contadores esperados

| Campo | Significado |
|---|---|
| `scanned` | Pedidos lidos (filtro parcial / período) |
| `candidates` | Pedidos com modo staged ou residual órfão |
| `rebuilt` | Rebuilds O2C OK (apply) |
| `errors` | Falhas de carga/rebuild |

---

## 5. Validação pós-apply

```bash
npm run audit:sales-order:effective-schedule -- --order="PD 02596"
```

Conferir: residual só nas posições restantes; sem rateio 33%/33%/33% após 1ª entrega.
