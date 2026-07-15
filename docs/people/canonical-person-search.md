# Pessoa canônica — busca e resolução (Prompt 03)

Motor backend unificado. Integrado na UI do **Novo Colaborador** (aba Profissional) via `EmployeePersonLinkField` → `GET /api/people/resolve`.

## Endpoints

| Método | Rota | Permissão |
|--------|------|-----------|
| `GET` | `/api/people/resolve` | `people.search` **ou** `employees.view` / `employees.edit` / `users.manage` |
| `GET` | `/api/people/search` | idem (compat legado; gera DTO antigo a partir do motor) |

### Query (`/api/people/resolve`)

- `q` — nome, nome social, e-mail, telefone; CPF só se PII
- `page` (default 1), `limit` (default 20, máx. 50)
- `excludeEmployeeId` — evita conflito consigo no link de colaborador
- `includeInactive=1` — inclui inativos (default: só ativos)

### Resposta (conceitual)

```json
{
  "items": [{
    "displayName": "...",
    "socialName": null,
    "email": null,
    "emailMasked": "jo***@empresa.com",
    "phoneMasked": "*******8888",
    "cpfMasked": "***.***.789-09",
    "origin": "Colaborador",
    "roles": ["Colaborador"],
    "status": "ACTIVE",
    "personId": null,
    "linkStatus": "legacy_unlinked",
    "podeVincular": true,
    "motivoBloqueio": null,
    "sourceKind": "employee",
    "sourceEntityId": "<uuid IndusCost>"
  }],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1, "q": "..." }
}
```

Não retorna IDs técnicos Nomus.

## `linkStatus`

| Status | Significado |
|--------|-------------|
| `canonical_linked` | Já tem `personId` |
| `legacy_unlinked` | Origem sem vínculo; pode vincular |
| `possible_match` | Evidência (ex.: e-mail igual a outra Person) — exige confirmação |
| `conflict` | Bloqueado (`podeVincular=false`) |
| `unavailable` | Reservado |

## Privacidade

- Sem `people.pii.view` / `employees.edit` / `users.manage` / admin: **não** busca por CPF; `email` e `cpf` vêm `null`; máscaras sempre preenchidas quando há dado.
- Autenticação obrigatória (`requireAppAuth` + permissão de busca).

## Fontes

Person, Employee, AppUser, CommissionPerson, FleetDriver, Customer PF (contato denormalizado). Sem SupplierContact (inventário Prompt 01).

## Implementação

- `src/lib/canonicalPersonSearch.server.ts`
- `src/lib/canonicalPersonRoutes.ts`
- Testes: `src/lib/canonicalPersonSearch.test.ts`
