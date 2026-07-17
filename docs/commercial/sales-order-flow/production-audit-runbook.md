# OP-78 — Runbook: auditoria de produção do Fluxo de Pedidos

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | OP-78 |
| **Atualizado** | 2026-07-17 |
| **Script** | `scripts/auditSalesOrderFlow.ts` |
| **Comando** | `npm run audit:sales-order:flow` |
| **Motores** | Evidência OP-49 · Item OP-50 · Pedido OP-51 · Fingerprint/draft OP-54 |

O Cursor **não** tem acesso ao banco de produção. Este runbook descreve como validar o ciclo de vida do Kanban com dados reais **no servidor** (ou ambiente com `DATABASE_URL` do stage).

---

## 1. Garantias

| Garantia | Como |
|---|---|
| Somente leitura | `findFirst` / `findMany` + loaders de evidência e repositório; sem create/update/delete |
| Sem Nomus HTTP | Sem sync / fetch Nomus no script e no loader |
| Sem escrita | Não chama `recomputeSalesOrderFlow` nem rebuild apply |
| Senha não exibida | `DATABASE_URL` sanitizada → `protocol://host:port/db` |
| Decimal JSON-safe | `Prisma.Decimal` → string `"1234.56"` |
| Saída JSON + Markdown | stdout + arquivos em `docs/generated/` |
| Exit code | `0` ok / pedido ausente; `1` falha técnica |

---

## 2. Pré-requisitos no servidor

1. Checkout do branch com o Fluxo de Pedidos (OP-45…OP-78).
2. `.env` com `DATABASE_URL` apontando para stage/produção **preferencialmente read-only** (usuário só SELECT).
3. Dependências: `npm ci` (ou `npm install`).
4. Pedido já sincronizado no Prisma (`SalesOrder`, itens, OP, DS, NF, snapshots se existirem).

---

## 3. Comando

```bash
npm run audit:sales-order:flow -- --order="PD 02596"
```

Equivalente:

```bash
npm run audit:sales-order:flow -- --order=PD02596
```

Saídas customizadas:

```bash
npm run audit:sales-order:flow -- \
  --order="PD 02596" \
  --json-output=/tmp/pd02596-flow.json \
  --markdown-output=/tmp/pd02596-flow.md
```

`--apply` **não** é aceito (auditoria é read-only).

### Defaults

| Artefato | Caminho |
|---|---|
| JSON | `docs/generated/sales-order-flow-audit-PD02596.json` |
| Markdown | `docs/generated/sales-order-flow-audit-PD02596.md` |

---

## 4. O que o relatório contém

1. Pedido (código, status, cliente, vendedor, datas)
2. Resumo de liberação (pendentes / liberados / cancelados)
3. Itens: necessidade de produção, OPs, produção, documentos, NF, atendimento FIN-03
4. Estágio calculado por item + motivo / próxima ação / progressos
5. Etapa consolidada do pedido, gargalo e área responsável
6. Snapshot persistido (pedido + itens)
7. Divergência cálculo × snapshot (`fingerprint_match` / `fingerprint_changed` / `first_run`)
8. Eventos recentes
9. Management (prioridade, bloqueio, responsável)
10. Inconsistências (pedido + itens)

---

## 5. Interpretação rápida

| Situação | Esperado |
|---|---|
| Snapshot alinhado ao motor | `divergence.hasDivergence=false`, `planReason=fingerprint_match` |
| Snapshot ausente | `planReason=first_run`, `with_divergences` |
| Evidência mudou sem rebuild | `fingerprint_changed` + mismatches de estágio/fingerprint |
| Pedido não no banco | `status=unavailable`, exit `0` |
| `DATABASE_URL` inválida | exit `1` |

---

## 6. Checklist operacional

- [ ] Log mostra `modo READ_ONLY`
- [ ] Log mostra `banco: postgresql://host.../db` **sem** usuário/senha
- [ ] JSON e Markdown gerados
- [ ] Conferir gargalo e etapa consolidada vs Kanban
- [ ] Se houver divergência, avaliar `rebuild:sales-order-flow --preview` (não apply às cegas)

---

## 7. Restrições

- Não substitui o rebuild; só diagnostica.
- Não altera `computationVersion` nem materializa eventos.
- Não chama APIs Nomus.
- Cursor / agentes locais **não** devem apontar `DATABASE_URL` de produção sem política explícita da operação.
