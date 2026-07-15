# Operações e Administração — permissões (Prompt 15)

| | |
|---|---|
| **Padrão** | Comissões / Prompt 13 (`canViewResource` + legado) |
| **Fonte FE** | `operationsAdminPermissions.ts`, `permissionsClient` ResourceKeys, `sidebarMenuResources` |

---

## Módulos concluídos

### Operações
| Módulo | resourceKey | Ações gated |
|--------|-------------|-------------|
| Estoque + abas | `operations.inventory` (+ items/warehouses/movements/counts) | view módulo/abas |
| Compras | `operations.purchases` | create/edit já no FE |
| Máquinas | `operations.machines` | edit/delete FE |
| Performance | `operations.performance` | edit helpers existentes |
| Manutenção | `operations.maintenance` | manage (nova solicitação) |
| Frota | `operations.fleet` | granular `fleet.*` preservado |

### Administração
| Módulo | resourceKey | Proteção sensível |
|--------|-------------|-------------------|
| Pessoas / RH | `admin.employees` (+ personal_data / administrative_data / sensitive_data / links) | list: `EMPLOYEES_VIEW_PERMISSIONS`; create: `employees.create`\|`edit`; PII: `personal_data.view`/`people.pii.view`; sensível (salário/emergência): `sensitive_data.view`\|`edit`; admin notes: `administrative_data.view`\|`edit` |
| Configurações | `configuracoes` / `admin.settings` | seções via `canAccessSettingsSection` |
| Usuários / perfis | `admin.usuarios` / `admin.permissoes` | já (último SUPER_ADMIN) |
| Guia | `admin.guide` | view only |

### Facetas RH (Pessoas)
- Listagem: `employees.view` | `employees.edit` | `costs.view`.
- Create: `employees.create` | `employees.edit`.
- PII pessoal: `employees.personal_data.view` / `people.pii.view` (sem salario/emergencia).
- Sensivel: `employees.sensitive_data.view` | `employees.edit`.
- Notas admin: `employees.administrative_data.view` | `employees.edit`.
- `costs.view` sozinho nao revela facetas sensiveis; API audita via `logEmployeeHrAudit` sem e-mail em claro.

## Impedimentos
- URL direta RH/estoque sem view → Layout `evaluatePathViewAccess`
- Dados sensíveis RH mascarados sem `employees.sensitive_data.view` / `employees.edit` (facetas `personal_data` / `administrative_data` no GET)
- Último SUPER_ADMIN / auto-lockout — já no admin service
- Sem inventar DELETE de compras API nem abas fake de frota/ficha

## Testes
```bash
npm run test:operations-admin-permissions
npm run audit:permission-contract
```
