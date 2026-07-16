# Editor de permissões por usuário (PERM-35)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-16 |
| **Status** | Integrado com `PermissionsTree` (PERM-33) |
| **UI** | `src/components/AdminUsersModule.tsx` |
| **Bridge** | `src/lib/userPermissionsTree.ts` |

## Layout

**Topo:** busca/seleção do usuário · role atual · perfil aplicado · `permissionsVersion` · status.

**Ações:** aplicar perfil · reaplicar perfil · limpar exceções individuais.

**Área principal:** árvore PERM-33 com colunas **Valor do perfil** · **Exceção do usuário** · **Resultado efetivo**.

**Rodapé fixo:** alterações pendentes · cancelar · salvar permissões.

## Destaques

- DENY individual sobrepõe o perfil
- ALLOW individual sobrepõe o perfil
- Usuário herdando
- Perfil alterado depois do snapshot (drift bag × perfil)
- Mudanças ainda não salvas

## Após salvar

Incrementa `permissionsVersion` e recarrega o resultado efetivo na UI.

## Comandos

```bash
npm run test:user-permissions-matrix
npm run test:permissions-tree
```

## Evidência

- `docs/security/user-permissions-editor.preview.html`
- `docs/security/evidence/perm35-user-permissions-editor.png`
