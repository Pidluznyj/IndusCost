# Matriz de permissões (Prompt 08)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-15 |
| **Status** | Componente compartilhado — **ainda não** substitui telas finais |
| **Código UI** | `src/components/admin/PermissionMatrix.tsx` |
| **Lógica pura** | `src/lib/security/permissionMatrixUi/` |
| **Exemplos** | `src/components/admin/PermissionMatrix.examples.tsx` |

---

## Objetivo

Componente reutilizável para edição hierárquica de permissões (perfis e usuários), com colunas dinâmicas de ação.

## APIs consumidas

Structured admin (workbench de usuários):

- `GET /api/admin/users/:id/permissions` → `EditableTreeNodeDto[]`
- Adapter: `buildPermissionMatrixRowsFromAdminTree` + `draftFromAdminTree`
- Contrato Prompt 02: define quais ações existem por recurso (células suportadas vs `—`)
- Save futuro (não ligado neste prompt): `PUT .../permission-overrides` via `legacyFlagsFromMatrixDraftValues`

> Prompt 07 dedicado não está versionado como doc; a ponte atual é a API admin estruturada + contrato de ações.

## Colunas

Padrão: Ver, Criar, Editar, Excluir, Exportar, Executar, Gerenciar.  
Ações específicas do contrato (approve, close, …) entram quando presentes na árvore.  
Ação inexistente → **—** (não checkbox).

## Recursos da UI

- Expandir / recolher
- Busca e filtro por grupo
- Seleção em lote (permitir/negar Ver/Executar/Gerenciar)
- Estado parcial (indeterminate nos filhos)
- Herdado / concedido / negado + tooltip de origem
- Aviso **Pai bloqueado** (filhos mantêm config)
- Dirty + resumo de impacto + reset
- Loading / erro de API
- Teclado nativo nos checkboxes + botões com `aria-*`

## Comandos

```bash
npm run test:permission-matrix
```

## Fora de escopo neste passo

- Substituir `UserPermissionTree` / `PermissionEditor` nas telas
- Alterar guards / autorização efetiva
