# Pessoa canônica — núcleo (Prompt 02)

## Modelo adotado

**Reutilização** do hub `Person` já introduzido em `20260715190000`, endurecido em `20260715200000_canonical_person_core_harden`.

Campos de identidade:

- `displayName`, `socialName`
- `corporateEmail` (e-mail principal)
- `personalEmail`
- `cpfNormalized`, `phoneNormalized`
- `status`, `origin`, `createdByUserId`, `inactivatedAt`
- timestamps

## Vínculos estágio 1

| Papel | FK | Cardinalidade | onDelete |
|-------|-----|---------------|----------|
| Employee | `personId` opcional | 1:1 | SetNull |
| AppUser | `personId` opcional | 1:1 | SetNull |
| CommissionPerson | `personId` opcional | N:1 | SetNull |

FleetDriver/Customer mantêm `personId` já existente (não ampliados neste núcleo).

## Unicidade

- **Sem UNIQUE de CPF/e-mail no banco** nesta etapa (índices de busca apenas).
- Validação de colisão exata no service (`canonicalPersonCore.server.ts`).
- Nome **nunca** é chave única.

## Service

`src/lib/canonicalPersonCore.server.ts` — create / update / inactivate / link estágio 1 / DTOs.

## Migration servidor

```bash
npx prisma migrate deploy
npx prisma generate
```

Não executar pelo Cursor.
