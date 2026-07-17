# FIN-10 — Runbook: auditoria da agenda financeira efetiva do Pedido

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | FIN-10 |
| **Atualizado** | 2026-07-17 |
| **Script** | `scripts/auditEffectiveSalesOrderSchedule.ts` |
| **Comando** | `npm run audit:sales-order:effective-schedule` |
| **Motor** | FIN-05 (`salesOrderEffectiveFinancialSchedule`) |

O Cursor **não** tem acesso ao banco de produção. Este runbook descreve como validar a regra com dados reais **no servidor** (ou ambiente com `DATABASE_URL` do stage).

---

## 1. Garantias

| Garantia | Como |
|---|---|
| Somente leitura | Prisma `findFirst` + `getOrderFullAudit` (sem create/update/delete) |
| Sem chamada Nomus HTTP | Sem sync / fetch Nomus no script e no loader |
| Sem alteração do banco | Auditoria não grava fatos nem títulos |
| Senha não exibida | `DATABASE_URL` sanitizada → `protocol://host:port/db` |
| Decimal JSON-safe | `Prisma.Decimal` → string `"1234.56"` |
| Saída JSON + Markdown | stdout + arquivos em `docs/generated/` |
| Exit code | `0` ok / pedido ausente; `1` falha técnica |

---

## 2. Pré-requisitos no servidor

1. Checkout do branch com FIN-05…FIN-10.
2. `.env` com `DATABASE_URL` apontando para o stage/produção **read-only** (preferível usuário só SELECT).
3. Dependências: `npm ci` (ou `npm install`).
4. Pedido já sincronizado no Prisma (`SalesOrder`, documentos, NF, CR).

---

## 3. Comando

```bash
npm run audit:sales-order:effective-schedule -- --order="PD 02596"
```

Equivalente:

```bash
npm run audit:sales-order:effective-schedule -- --order=PD02596
```

Saídas customizadas:

```bash
npm run audit:sales-order:effective-schedule -- \
  --order="PD 02596" \
  --json-output=/tmp/pd02596-effective.json \
  --markdown-output=/tmp/pd02596-effective.md
```

### Defaults

| Artefato | Caminho |
|---|---|
| JSON | `docs/generated/effective-schedule-audit-PD02596.json` |
| Markdown | `docs/generated/effective-schedule-audit-PD02596.md` |

---

## 4. O que o relatório contém

1. Pedido (código, condição, valor ativo)
2. Parcelas originais
3. Itens: status, classificação FIN-03, qtde pedida/atendida
4. Documentos de Saída e alocação por item
5. Cobertura: coberto CR / Doc / corte / residual / não resolvido
6. NF-es e CRs
7. Agenda efetiva final (CR + Doc sem CR + residual)
8. Agenda original substituída
9. Alertas do motor + alertas de consumidor (FIN-09)
10. Inconsistências detectadas (ex.: Doc+CR mesma NF na agenda; corte com residual)

---

## 5. Interpretação rápida

| Situação | Esperado |
|---|---|
| Pedido com CR da mesma NF do Documento | Agenda efetiva só CR; Doc não duplica |
| Atendimento parcial | Residual ativo nas datas do Pedido |
| Atendido com corte | `cutAmount` > 0; residual do item = 0; sem alerta de vencido do corte |
| Documento sem CR / sem condição | `DOCUMENT_AWAITING_FINANCIAL_SCHEDULE` |
| Pedido não no banco | `status=unavailable`, exit `0` |
| `DATABASE_URL` inválida | exit `1` |

---

## 6. Checklist operacional

- [ ] Confirmar que o log mostra `banco: postgresql://host.../db` **sem** usuário/senha
- [ ] Confirmar `modo READ_ONLY`
- [ ] Abrir o Markdown e conferir residual vs CR
- [ ] Se `status=with_inconsistencies`, tratar códigos em **Inconsistências**
- [ ] Não rodar sync Nomus como parte desta auditoria

---

## 7. Testes locais (sem banco)

```bash
npx tsx --test src/lib/finance/effectiveSalesOrderScheduleAudit.test.ts
```

Cobre args, sanitização, Decimal, relatório unavailable e scan read-only do script/server.

---

## 8. Relação com a trilha FIN

| Ticket | Papel |
|---|---|
| FIN-05 | Motor |
| FIN-06/07 | Detalhe do Pedido |
| FIN-08 | Contas a Receber contextual |
| FIN-09 | Alertas / consumidores |
| **FIN-10** | **Auditoria read-only operacional** |

Política: `docs/finance/effective-schedule-policy.md`  
Consumidores: `docs/finance/effective-schedule-consumers.md`
