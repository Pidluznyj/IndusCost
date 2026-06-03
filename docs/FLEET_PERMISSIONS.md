# Gestão de Frota — matriz de permissões

Todas as rotas `/api/fleet/*` exigem autenticação (`requireAppAuth`). Sem sessão válida: **401**.

Sem a permissão exigida: **403** (`FORBIDDEN`, mensagem amigável).

Valores financeiros em respostas de leitura são mascarados (`maskFinancialData`) quando o usuário não tem permissão financeira (`canViewFleetFinancial`).

## Permissões legadas (mantidas)

| Permissão | O que permite |
|-----------|---------------|
| `fleet.view` | Visualização geral (dashboard, listagens, relatórios) — **sem** valores financeiros |
| `fleet.manage` | Administração ampla — **exceto** `fleet.settings.manage` |
| `fleet.vehicles.edit` | Veículos, contratos e documentos (cadastro/edição) |
| `fleet.reservations.create` | Reservas + checkout/check-in |
| `fleet.reservations.approve` | Aprovar/rejeitar reservas |
| `fleet.maintenance.manage` | Manutenções (CRUD) |
| `fleet.financial.view` | Valores monetários e custos |
| `fleet.settings.manage` | Parâmetros e importações |

## Permissões granulares (catálogo Admin)

Agrupadas no catálogo `Gestão de Frota` (`permissionCatalog.ts`). Exemplos:

- **Leitura:** `fleet.dashboard.view`, `fleet.vehicles.view`, `fleet.reservations.view`, …
- **Operação:** `fleet.usage.checkout`, `fleet.usage.checkin`
- **Aprovação:** `fleet.reservations.approve` (crítica)
- **Financeiro:** `fleet.costs.view`, `fleet.costs.manage`, `fleet.financial.view` (crítica)
- **Configuração:** `fleet.settings.manage` (crítica)

A expansão legado → granular está em `src/lib/fleetPermissionResolve.ts` (`expandFleetPermissions`, `canFleet`).

## Presets (Admin → Usuários)

| Template | Uso |
|----------|-----|
| Frota — Administrador | `fleet.view` + `fleet.manage` + `fleet.settings.manage` + financeiro |
| Frota — Operador | Visualização + reservas + checkout/check-in |
| Frota — Financeiro | Visualização + `fleet.financial.view` |
| Frota — Manutenção | Visualização + `fleet.maintenance.manage` |
| Frota — Solicitante | Visualização + criar reservas |
| Frota — Visualizador | Somente `fleet.view` |

## Implementação

- Resolução: `src/lib/fleetPermissionResolve.ts`, reexport `src/lib/fleetAuth.ts`
- Guards HTTP: `src/lib/fleetRouteGuards.ts` (`createFleetRouteGuards`)
- UI: `src/components/fleet/fleetPermissions.ts` (`useFleetPermissions`)
- Catálogo + presets: `src/lib/permissionCatalog.ts`, `src/lib/permissionCatalogUtils.ts`

## Auditoria de alteração de permissões

Alterações em usuários passam por guardrails em `PATCH /api/users/:id` (anti auto-bloqueio). **Log dedicado de diff de permissões** está planejado na fase `INDUSCOST-ACCESS-PERMISSIONS-AUDIT-LOG-B` — pendência documentada, sem migration nesta entrega.
