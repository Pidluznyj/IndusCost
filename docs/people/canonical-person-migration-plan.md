# Pessoa canônica — migration e backfill

## Migration

`prisma/migrations/20260715190000_canonical_person`

- Tabela `Person`
- `personId` opcional em Employee, AppUser, CommissionPerson, FleetDriver, Customer
- Unique parcial CPF / corporateEmail em Person
- Unique parcial Employee.personId / AppUser.personId

**Servidor (não executar pelo Cursor):**

```bash
npx prisma migrate deploy
npx prisma generate
# reiniciar Node
```

## Backfill (diagnóstico + apply seguro)

**Não executar apply em produção sem revisão do dry-run.**

Motor: `src/lib/canonicalPersonBackfill.ts` (+ `.server.ts`).

### Categorias

| Categoria | Apply? | Regra |
|-----------|--------|-------|
| inequívoca | sim | CPF válido único ou e-mail único sem conflito |
| provável | não | nome ou telefone isolados; contatos de cliente |
| ambígua | não | múltiplas Persons no mesmo CPF/e-mail |
| conflito | não | unique Employee/AppUser, CPF×e-mail divergentes, checksum inválido |
| sem correspondência | não | órfão sem Person |

Nome nunca gera merge automático. Telefone isolado nunca. Contato de cliente (`contactPersonId`) só relatório.

### Comandos

```bash
# Dry-run (padrão) — JSON/CSV mascarados em tmp/
npx tsx scripts/canonical-person-backfill.ts --dry-run
npx tsx scripts/canonical-person-backfill.ts --dry-run --out tmp/person-backfill --limit 500

# Apply explícito — só unequivocos; exige confirmação
npx tsx scripts/canonical-person-backfill.ts --apply --confirm-apply
npx tsx scripts/canonical-person-backfill.ts --apply --confirm-apply --limit 100 --batch 50

# Atalho legado
npx tsx scripts/canonical-person-backfill-dry-run.ts

# API (users.manage | people.link.manage)
# GET /api/people/diagnostics/unequivocal-matches
```

### Riscos

- Unique parcial: um Person só pode ter um Employee e um AppUser.
- Apply **apenas** `UPDATE personId` — não cria/funde/apaga Person nem papéis.
- Relatórios nunca trazem CPF/e-mail completos (máscara).

### Rollback (após apply)

Papéis legados sem `personId` continuam válidos. Para desfazer vínculos do apply:

```sql
-- usar entityIds / personIds do JSON *-apply.json → linkedIds
UPDATE "Employee" SET "personId" = NULL WHERE id = ANY(ARRAY[...]::uuid[]);
-- idem AppUser / CommissionPerson / FleetDriver / Customer (identity)
```

Não apagar linhas `Person`. Revert de migration só se ainda não houver dependências novas.

## Permissões

| Chave | Uso |
|-------|-----|
| `people.search` | busca (+ aliases employees.view) |
| `people.link.manage` | vincular/desvincular (+ employees.edit) |
| `people.pii.view` | e-mail/CPF sem máscara |
| Facetas `employees.*` / `admin.employees.*` | ver `canonical-person-links.md` |

## Preflight (CI / local, sem apply)

```bash
npx tsx scripts/canonical-person-migration-preflight.ts
# Banco isolado (homolog):
# DATABASE_URL_TEST=postgresql://... npx tsx scripts/canonical-person-migration-preflight.ts --db-validate
```

Checklist completo: [`canonical-person-homologation-checklist.md`](./canonical-person-homologation-checklist.md).
