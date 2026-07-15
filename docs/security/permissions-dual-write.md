# Dual-write e materialização legada (Prompt 06)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-15 |
| **Status** | Serviço central — acesso efetivo continua `AppUser.permissions[]` |
| **Código** | `src/lib/security/permissionDualWrite/` |
| **CLI** | `scripts/permissionDualWriteReport.ts` (somente dry-run / relatório) |

---

## Objetivo

Manter a árvore estruturada (`PermissionResource` + flags Ver/Executar/Gerenciar) e o catálogo legado (`AppUser.permissions[]`) sincronizados **sem loops de gravação** e **sem alterar o acesso efetivo** no modo compatível.

## Algoritmo (dois sentidos controlados)

### 1) Grants estruturados → permissões legadas materializadas

- Entrada: mapa efetivo `resourceKey → { canView, canExecute, canManage }` + bag legado atual.
- Para cada recurso do índice (seed PT / aliases 1:1), emite aliases conforme o eixo:
  - manage → `*.manage` / `users.manage` / …
  - execute → `*.execute|export|sync|create|apply`
  - view → demais aliases
- **Preserva** chaves do bag anterior que estão no `PERMISSION_CATALOG` mas **não** têm alias estrutural.
- Não apaga permissões desconhecidas de catálogo sem mapeamento.
- Ordenação estável (`Array.sort` lexicográfico ASCII).
- Escrita: apenas `AppUser.permissions[]` (caminho admin já existente). **Não** regenera overrides a partir do legado no mesmo passo.

### 2) Permissões legadas → representação estruturada inicial

- Projeção pura: aliases → flags (+ opção de elevar ancestrais para UI).
- Relatório de não mapeadas (`no_structural_alias` / `outside_catalog`).
- **Apply de backfill** (futuro): grava só `UserPermissionOverride`; **nunca** regrava `permissions[]` no mesmo passo (anti-loop).
- Exige `confirmBackfillApply=true` além de `dryRun=false`.
- **Não executar backfill em produção neste prompt.**

## Idempotência e dry-run

- Mesmo input → mesmo bag legado ordenado.
- `applyDualWrite({ dryRun: true })` devolve snapshot before/after sem escrever.
- Plano inclui `gainedLegacy` / `lostLegacy` / `preservedUnmapped` / `unmappedReport`.

## Pontos de gravação analisados

| Ponto | Comportamento |
|-------|----------------|
| `saveUserPermissionOverrides` | Dual-write legado via materializador central **preservando** unmapped do bag atual |
| `applyRolePreset` / `planApplyRolePreset` | Idem, com preserve do bag anterior |
| `AccessProfile` assign | Continua copy-on-assign de chaves legadas (sem estrutura) |
| `AppUser.permissions[]` direto | Runtime efetivo inalterado |
| Backfill legado→estrutura | Opt-in; desligado por padrão |

## Comandos

```bash
npm run permissions:dual-write:report
npm run test:permission-dual-write
```

Relatório: `docs/generated/permission-dual-write-report.md`

## Produção

**Não** executar backfill apply nem migration em produção neste prompt.
