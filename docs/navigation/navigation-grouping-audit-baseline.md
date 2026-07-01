# Baseline — auditoria de agrupamento da sidebar

Snapshot oficial usado por `npm run audit:navigation-grouping`.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `navigation-grouping-baseline.json` | Snapshot versionado (fonte de comparação) |
| `navigation-grouping-audit-report.json` | Último relatório gerado pela auditoria (runtime) |
| `../src/lib/navigationGroupingAudit.ts` | Motor de auditoria |
| `../scripts/audit-navigation-grouping.ts` | Script CLI |

## Conteúdo do baseline

Cada item contém:

- `order` — ordem em `SIDEBAR_MODULE_ORDER`
- `itemId` — módulo (`AppModuleId`)
- `label` — rótulo em `MODULE_LABELS`
- `path` — URL canônica (`/{itemId}`)
- `groupId` / `groupLabel` — grupo visual da sidebar
- `isDirect` — `true` apenas para Dashboard
- `requiredPermissions` — chaves OR de `canAccessModule` (espelho read-only)

Também inclui:

- `appModuleRoutes` — presença de `path="{moduleId}"` em `App.tsx`
- `permissionKeysByModule` — mapa completo de permissões de menu

## Status da auditoria

| Status | Significado | Exit code |
| --- | --- | --- |
| **OK** | Nenhuma regressão detectada | 0 |
| **ALERTA** | Divergência não bloqueante (ex.: item novo vs baseline) | 0 |
| **BLOQUEANTE** | Path, label, permissão, item ou rota crítica alterada | 1 |

## O que a auditoria protege

- Paths e labels de menu inalterados
- Cada item em exatamente um grupo, sem duplicação
- Grupos vazios não aparecem na sidebar
- Dashboard permanece item direto
- Permissões de menu preservadas (`MODULE_MENU_PERMISSION_KEYS`)
- Agrupamento não concede acesso extra nem oculta itens indevidamente
- Rota ativa abre o grupo correto
- Rotas principais em `App.tsx` preservadas
- Arquivos de navegação no frontend sem import Prisma

## Regenerar baseline (somente se mudança intencional)

```bash
npx tsx -e "import { writeFileSync } from 'node:fs'; import { buildNavigationGroupingSnapshot } from './src/lib/navigationGroupingAudit.ts'; writeFileSync('docs/navigation/navigation-grouping-baseline.json', JSON.stringify(buildNavigationGroupingSnapshot(), null, 2));"
```

Revisar diff e commitar junto com justificativa.

## Confirmações

- Permission keys do catálogo: **inalteradas** pela auditoria
- Autorização real (`canAccessModule`, endpoints): **fora do escopo** — continua por key individual
- Rotas/telas: baseline valida presença de rotas de módulo em `App.tsx`, não altera `App.tsx`
