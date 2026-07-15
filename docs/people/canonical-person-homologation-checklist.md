# Pessoa Canônica / RH — checklist de homologação e deploy

| | |
|---|---|
| Ambiente alvo | Homologação (não produção via Cursor) |
| Escopo | Person, Colaborador, vínculos, clientes PF/PJ, permissões, backfill |
| Status | Pronto para homologação **após** migrate deploy no servidor de teste |

---

## 1. Matriz por persona

| Persona | Permissões típicas | Esperado |
|---------|-------------------|----------|
| SUPER_ADMIN | papel | Acesso total; auditoria técnica; link/unlink |
| ADMIN | papel | RH + configurações; dados sensíveis |
| RH completo | `employees.view` + `employees.edit` (+ opcional `people.*`) | Criar/editar; PII; salário; vínculos; user-link |
| RH somente leitura | `employees.view` | Lista/ficha profissional; **sem** PII/salário/emergência; vínculos view se `employees.links.view` ou view |
| Gestor | `employees.view` (sem edit) | Consulta equipe/lista; sem edição/salário |
| Sem dados pessoais | `employees.view` sem `personal_data`/`edit`/`pii` | Aba pessoal mascarada; API redigida |
| Sem vínculos | sem `links.manage` / `people.link.manage` | Vê cards se view; sem desvincular |
| Deny específico | view sem `sensitive_data` / sem `links.manage` | 403 em mutações; UI sem botões |
| Legado | colaborador sem `personId` / CC texto | Abre ficha; alerta sem Person; edição preserva legado |

---

## 2. Casos de homologação (manual + API)

Marcar cada item em homologação:

### Colaborador
- [ ] Criar colaborador novo (CC oficial + cargo + e-mail único)
- [ ] Vincular pessoa existente (resolve/search)
- [ ] Criar nova pessoa no fluxo
- [ ] Editar ficha (profissional)
- [ ] E-mail corporativo duplicado (case) → 409
- [ ] Centro de custo oficial (`costCenterId`)
- [ ] Gestor válido; self/ciclo bloqueados
- [ ] Colaborador legado sem Person / CC só texto

### Usuário
- [ ] Vínculo AppUser pelo e-mail corporativo
- [ ] Conflito (AppUser já ligado a outro) → erro claro
- [ ] Desvínculo não apaga login

### Abas
- [ ] Pessoal / emergência mascarados sem permissão fina/`edit`
- [ ] EPI gravável com `employees.epi.manage` ou `edit`
- [ ] Referência administrativa / observações admin redigidas
- [ ] Vínculos no sistema: cards + empty + conflito + auditoria técnica

### Clientes
- [ ] Cliente PF — vínculo identidade
- [ ] Cliente PJ — **não** vincula identidade; contato via `contactPersonId`
- [ ] PUT `/api/customers/:id` ignora `personId` / `contactPersonId`
- [ ] Pessoa comissionada aparece em vínculos quando há Person

### Segurança
- [ ] URL direta `/employees` sem view → Access Denied
- [ ] API direta GET/POST/PUT sem grant → 403
- [ ] Dados sensíveis ausentes no JSON sem facet/`edit`

### Backfill / migration
- [ ] Dry-run script gera JSON/CSV mascarados
- [ ] Apply **não** rodado em prod sem revisão; só unequivocos
- [ ] Migrate em banco de teste OK
- [ ] Rollback documentado compreendido

---

## 3. Deploy no servidor (comandos exatos — executar no host manutenido)

Ordem obrigatória. **Não executar pelo Cursor contra produção.**

```bash
# 0) Backup do banco (procedimento interno da empresa)
# pg_dump / snapshot gerenciado

# 1) Código
git fetch origin
git checkout main
git pull --ff-only origin main

# 2) Dependências + Prisma Client
npm ci
npx prisma generate

# 3) Migrate (após backup)
npx prisma migrate deploy

# 4) Build
npm run build

# 5) Restart do serviço Node (systemd/pm2/docker — conforme ambiente)
# ex.: sudo systemctl restart induscost

# 6) Smoke (com sessão autenticada)
# - GET /api/employees → 200 com employees.view
# - GET /api/employees/:id/system-links → 200
# - GET /api/customers/:id/people-links → 200
# - UI /employees abre; negar URL sem permissão
```

### Sync Nomus (checagem)

- Confirmar jobs/sync existentes **não** preenchem `personId` automaticamente por nome.
- Backfill Person é **manual** (script dry-run → apply); não acoplar ao sync Nomus.

### Dry-run backfill (homolog only)

```bash
npx tsx scripts/canonical-person-backfill.ts --dry-run --out tmp/person-backfill-homolog
# Revisar JSON/CSV. Apply só se aprovado:
# npx tsx scripts/canonical-person-backfill.ts --apply --confirm-apply --limit 50
```

---

## 4. Rollback

### App (código)
```bash
git checkout <hash-anterior-estavel>
npm ci
npx prisma generate
npm run build
# restart serviço
```

### Vínculos Person (dados)
Não dropar `Person`. Desfazer apply:

```sql
-- Usar linkedIds do relatório *-apply.json
UPDATE "Employee" SET "personId" = NULL WHERE id = ANY(...);
UPDATE "AppUser" SET "personId" = NULL WHERE id = ANY(...);
-- CommissionPerson / FleetDriver / Customer conforme relatório
```

### Migration
Só reverter migration se **ainda não** houver dependência de dados; preferir forward-fix. Papéis sem `personId` continuam válidos.

---

## 5. Critérios de aceite (go / no-go)

| Critério | Go |
|----------|-----|
| `npm run build` zero erro | obrigatório |
| Suíte people/RH hardening + `npm test` relevantes | obrigatório |
| Endpoints sensíveis com guard | obrigatório |
| Sem vínculo automático por nome/telefone | obrigatório |
| Colaborador legado abre/edita | obrigatório |
| Migration deploy em homolog OK | obrigatório |
| Backfill dry-run revisado antes de qualquer apply | obrigatório |
| Documentação alinhada ao código | obrigatório |

---

## 6. Migrations pendentes relevantes

| Migration | Conteúdo |
|-----------|----------|
| `20260715180000_employee_registration_lookups` | e-mail corporativo, CC, gestor |
| `20260715190000_canonical_person` | tabela Person + FKs |
| `20260715200000_canonical_person_core_harden` | endurecimento Person |
| `20260715210000_employee_corporate_email_normalize` | normalize/unique e-mail |
| `20260715220000_customer_contact_person` | `contactPersonId` |

Confirmar com `npx prisma migrate status` no servidor de homologação.
