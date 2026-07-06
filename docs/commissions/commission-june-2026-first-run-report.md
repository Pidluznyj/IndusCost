# Relatório — Primeira carga Comissões Junho/2026

**Data:** 2026-07-01  
**Período alvo:** 06/2026 (`2026-06-01` a `2026-06-30`)

---

## 1. Commit

_Preencher após push: hash do commit desta entrega._

---

## 2. Arquivos alterados nesta entrega

### Correções
- `scripts/audit-commission-financial-release.ts` — filtro `SUPERSEDED` inválido → `activeCommissionRecordWhere`
- `src/lib/commissions/commission-record-status.ts` — status inativos centralizados

### Novos serviços/scripts
- `src/lib/commissions/commission-preview-calculation.server.ts` — preview sem gravar
- `scripts/commission-script-utils.ts` — utilitários CLI
- `scripts/audit-commission-june-readiness.ts`
- `scripts/audit-commission-rules-coverage.ts`
- `scripts/export-commission-june-comparison.ts`
- `scripts/compare-commission-with-nomus-export.ts`

### Melhorias
- `scripts/backfill-commission-persons.ts` — `--preview`/`--apply`, filtro `--month`
- `scripts/recalculate-commissions.ts` — preview detalhado + gate de segurança no apply
- `src/lib/commissions/commissionPersons.server.ts` — backfill por período
- `src/lib/commissions/commission-scripts.test.ts`
- `docs/commissions/commission-calculation-runbook-june-2026.md`

---

## 3. Como a comissão é calculada

Ver runbook: `docs/commissions/commission-calculation-runbook-june-2026.md`

Resumo: Pedido → regra ativa → prevista; NF-e/doc. saída → supersede + confirmada; AR → liberação proporcional; pagamento manual via lote. **Sem regra = sem registro.** **Sem apply automático de pagamento.**

---

## 4. Status pessoas comissionadas

| Etapa | Resultado |
|-------|-----------|
| Backfill preview | Executar no servidor: `backfill-commission-persons.ts --year=2026 --month=6 --preview` |
| Backfill apply | Executar no servidor se preview OK |

Ambiente local desta revisão: **PostgreSQL indisponível** (`localhost:5432`).

---

## 5. Status regras

| Etapa | Resultado |
|-------|-----------|
| Auditoria cobertura | `audit-commission-rules-coverage.ts --year=2026 --month=6` |

**BLOQUEANTE se zero regras ativas** — cadastrar em Comissões → Regras (não inventar percentual).

---

## 6. Cálculo junho/2026

| Modo | Status |
|------|--------|
| Preview | `recalculate-commissions.ts --year=2026 --month=6 --preview` |
| Apply | **Somente no servidor** após preview + readiness sem BLOQUEANTE |

Apply local: **não executado** (sem banco).

---

## 7–14. Totais (pós-execução no servidor)

Após rodar preview/apply no servidor, preencher:

| Métrica | Valor |
|---------|-------|
| Pedidos analisados | _TBD_ |
| Registros gerados | _TBD_ |
| Comissão prevista | _TBD_ |
| Comissão confirmada | _TBD_ |
| Aguardando recebimento | _TBD_ |
| Liberado | _TBD_ |
| Pago | _TBD_ |

---

## 15. Bloqueios

| Bloqueio | Severidade |
|----------|------------|
| Enum `SUPERSEDED` inválido em auditoria financeira | **Corrigido** |
| PostgreSQL local offline | Ambiente dev — executar no servidor produção |
| Regras ativas ausentes | **Operacional** — cadastro manual obrigatório |

---

## 16. Exportação Nomus

```bash
npx tsx scripts/export-commission-june-comparison.ts --year=2026 --month=6 --outDir=tmp/commissions-june-2026
npx tsx scripts/compare-commission-with-nomus-export.ts --year=2026 --month=6 --nomusFile=tmp/nomus-june.csv
```

Arquivos gerados em `tmp/commissions-june-2026/`:
- `induscost-commissions-june-2026.csv`
- `induscost-commissions-june-2026.json`
- `commission-comparison-template-nomus.csv`
- `commission-summary-june-2026.md`

---

## 17. Próximos passos Nomus

1. Exportar relatório de comissão Nomus jun/2026 para CSV.
2. Preencher template ou usar `--nomusFile`.
3. Rodar `compare-commission-with-nomus-export.ts`.
4. Revisar divergências `DIVERGENTE` / `FALTANDO_*`.

---

## 18. Auditorias executadas (revisão código)

| Script | Resultado local |
|--------|-----------------|
| `audit-commission-financial-release.ts` | Erro técnico **corrigido**; falha só por DB offline |
| Demais scripts | Implementados; requerem servidor |

---

## 19. Checks executados

| Check | Resultado |
|-------|-----------|
| `npm run test:commissions` | **69/69 pass** |
| `npx prisma validate` | OK |
| `npm run check:frontend-server-imports` | OK |
| `npm run build` | OK |

---

## 20. Escopo respeitado

Não alterados: pedidos, AR, NF-e, financeiro, sync Nomus, margem, custo industrial, projetos, sidebar (exceto teste), permissões fora de Comissões.

---

## 21. Telas após apply no servidor

Com registros calculados, Dashboard/Previstas/Confirmadas/Liberação deixam de ficar zerados. Sem regras + sem apply: permanecem vazias (esperado).

---

*Execute a sequência do runbook no servidor de produção para concluir a primeira carga de junho/2026.*
