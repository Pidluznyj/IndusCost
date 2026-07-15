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
| Pessoas / RH | `admin.employees` | salário / emergência / CPF exigem `employees.edit` |
| Configurações | `configuracoes` / `admin.settings` | seções via `canAccessSettingsSection` |
| Usuários / perfis | `admin.usuarios` / `admin.permissoes` | já (último SUPER_ADMIN) |
| Guia | `admin.guide` | view only |

## Impedimentos
- URL direta RH/estoque sem view → Layout `evaluatePathViewAccess`
- Dados sensíveis RH mascarados sem `employees.edit`
- Último SUPER_ADMIN / auto-lockout — já no admin service
- Sem inventar DELETE de compras API nem abas fake de frota/ficha

## Testes
```bash
npm run test:operations-admin-permissions
npm run audit:permission-contract
```
