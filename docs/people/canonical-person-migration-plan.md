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

## Backfill

Dry-run inequívoco:

```bash
npx tsx scripts/canonical-person-backfill-dry-run.ts
# ou GET /api/people/diagnostics/unequivocal-matches (users.manage)
```

Só e-mail/CPF exato. Não auto-merge por nome.

## Rollback

Revert migration + redeploy commit anterior. Papéis legados sem personId continuam válidos.

## Permissões

| Chave | Uso |
|-------|-----|
| `people.search` | busca (+ aliases employees.view) |
| `people.link.manage` | vincular/desvincular (+ employees.edit) |
| `people.pii.view` | e-mail/CPF sem máscara |
