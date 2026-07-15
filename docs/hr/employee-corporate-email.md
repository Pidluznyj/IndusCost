# E-mail corporativo do colaborador

## Fonte de verdade

| Campo | Papel |
|-------|--------|
| `Employee.corporateEmail` | Vínculo profissional (cadastro RH) |
| `Person.corporateEmail` | E-mail principal da pessoa — só quando coerente via vínculo/resolução |
| `AppUser.email` | Login — **nunca** alterado automaticamente pelo cadastro de colaborador |

## Regras

- Trim + lowercase na persistência
- Formato válido; vazio/`null` permitido (legado)
- Unicidade **case-insensitive** entre colaboradores (`Employee_corporateEmail_lower_uidx`, partial)
- Não cria login
- Não vincula usuário automaticamente (vínculo explícito na ficha / `POST .../link-user`)
- Conflito com `AppUser` já ligado a **outro** colaborador → `CORPORATE_EMAIL_APPUSER_CONFLICT` (409)
- Usuário livre com o mesmo e-mail → aviso (`available_match`), cadastro permitido

## Migration

- `20260715180000_employee_registration_lookups` — coluna + índice unique CI
- `20260715210000_employee_corporate_email_normalize` — normaliza valores existentes + `IF NOT EXISTS` no índice

**Não executar migrate em produção por este agente.** Em deploy controlado, rode diagnóstico antes:

```bash
npx tsx scripts/diagnoseEmployeeCorporateEmailDuplicates.ts
```

## API

- `GET /api/employees/lookups/corporate-email?email=&excludeEmployeeId=`
- Validação em `prepareEmployeePersistedFields` (POST/PUT `/api/employees`)
- Auditoria: `employee.corporate_email.set` / `.change`

## UI

Campo na aba Profissional (Novo/Editar Colaborador): blur normaliza e pré-valida; detalhe mostra o e-mail na ficha.
