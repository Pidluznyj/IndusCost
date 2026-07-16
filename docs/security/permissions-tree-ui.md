# Árvore de permissões (PERM-33)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-16 |
| **Status** | Componente compartilhado — **ainda não** liga telas finais |
| **UI** | `src/components/admin/PermissionsTree.tsx` |
| **Lógica** | `src/lib/security/permissionsTreeUi/` |
| **Exemplos** | `src/components/admin/PermissionsTree.examples.tsx` |

## Objetivo

Substituir a matriz densa (metadados técnicos + “Pai bloqueado” repetido) por árvore legível:

**Módulo → Página/submenu → Aba → Ação**

## Layout

- Módulos em accordions
- Página como linha principal
- Abas recuadas
- Ações como linhas compactas
- Busca por nome
- Expandir tudo / Recolher tudo
- Contadores: permitidos · negados · herdados
- Cabeçalho sticky

## Colunas

| Coluna | Conteúdo |
|--------|----------|
| Recurso | Nome + chip (Módulo/Página/Aba/Ação) |
| Origem/perfil | Label do perfil/role |
| Decisão individual | Segmentado **Herdar \| Permitir \| Negar** |
| Resultado efetivo | Badge suave (verde / vermelho / cinza-âmbar) |

## Cores

- Permitido: verde suave (`emerald-50/100`)
- Negado: vermelho claro (`rose-50/100`)
- Herdado: âmbar/cinza suave
- Fundo claro (sem dark pesado)

## Viewports

Presets `viewportPreset="1366" | "1920" | "fluid"` + gallery em `PermissionsTreeViewportGallery`.

Evidências estáticas (preview HTML + capturas):

- `docs/security/permissions-tree-ui.preview.html`
- `docs/security/evidence/perm33-permissions-tree-1366x768.png`
- `docs/security/evidence/perm33-permissions-tree-1920x1080.png`

## Comandos

```bash
npm run test:permissions-tree
```

## Fora de escopo neste passo

- Ligar `AccessProfilesModule` / `AdminUsersModule`
- Alterar guards / autorização efetiva
- Storybook (não existe no repo; examples + testes fazem o papel)
