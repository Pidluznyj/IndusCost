# Backfill de permissões (P20 — Etapa B)

Transforma grants legados **intencionais e inequívocos** em `UserPermissionOverride` estruturados.

**Não executar em produção** sem:

1. Backup completo do banco
2. Relatório P20 (`permissions:compare:legacy-vs-effective`)
3. Preview revisado e aprovação humana

---

## Regras de migração

| Classificação | Auto-apply |
|---------------|------------|
| `alias_1_1` / `direct_key` | Sim, se round-trip compatível |
| `role` | Não — baseline da role |
| `profile` | Não — usar perfil |
| `mega_key` | **Não** — pendente manual |
| `bleed` | **Não** — nunca promover |
| `fallback` | **Não** |
| `unmapped` | Pendente |

### Guard rails

- **SUPER_ADMIN** — nunca alterado
- **Bag vazia + zero overrides** — skip (não injeta baseline)
- **costs.view** — mega-key; não expande para RH/máquinas/suprimentos
- **Bleed AP→Financeiro/Conciliação** — não promove
- **P20 lockout_risk** — bloqueia apply
- **permissions[] intacta** no apply (anti-loop)
- **Idempotência** — reexecução não duplica overrides iguais
- **Override existente conflitante** — pendente, não sobrescreve

---

## Comandos (servidor futuro — NÃO executar agora)

```bash
# 1) Snapshot comparativo (Etapa A)
npm run permissions:compare:legacy-vs-effective -- --from-db

# 2) Preview backfill (obrigatório)
npm run permissions:backfill:preview
npx tsx scripts/backfillPermissionOverrides.ts --from-db

# 3) Apply explícito (homolog/staging apenas, com backup)
npx tsx scripts/backfillPermissionOverrides.ts \
  --from-db \
  --apply \
  --confirm="BACKFILL PERMISSIONS" \
  --batch-size=25

# 4) Rollback a partir do snapshot pré-apply
npx tsx scripts/backfillPermissionOverrides.ts \
  --rollback \
  --run-id=<runId> \
  --confirm="ROLLBACK BACKFILL"

# Testes locais (fixtures in-memory)
npm run test:permission-backfill
npx tsx scripts/backfillPermissionOverrides.ts --fixtures-only
```

---

## Saídas

| Arquivo | Conteúdo |
|---------|----------|
| `docs/generated/permission-backfill-<runId>.json` | Preview/apply seguro (sem PII) |
| `docs/generated/permission-backfill-<runId>.md` | Resumo + Leticia |
| `docs/generated/permission-backfill-<runId>-pending.csv` | Pendências |
| `docs/generated/permission-backfill-<runId>-summary.csv` | Por subjectRef |
| `docs/generated/backfill-snapshots/<runId>.json` | Snapshot pré-apply (rollback) |

---

## Cenário Leticia

Usuário com `finance.accountsPayable.view` + override AP:

- Preview: idempotente se override seed (`financeiro.contas_pagar`) já existe
- Bleed finance/conciliação: **pendente**, não promovido
- Modo restrição absoluto (denies) continua via admin manual / P05 — **fora** do backfill automático de bag

---

## Arquitetura

```
src/lib/security/permissionBackfill/
  classifyLegacyKey.ts  — role/profile/mega/bleed/1:1
  planBackfill.ts       — preview + delta overrides
  applyBackfill.ts      — lotes, transação, rollback
  port.ts               — in-memory + Prisma
  snapshot.ts           — before-state para rollback
  safeExport.ts         — JSON/CSV sem PII
```

Integração P20: `compareAccessForSubject` bloqueia apply em `lockout_risk`.

---

## Auditoria

Cada apply grava `PermissionAuditLog` via `buildOverrideSaveAuditPlans` com `reason: p20-backfill`.

Rollback grava `p20-backfill-rollback:<runId>`.
