# Editor de Perfis de Acesso (PERM-34)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-16 |
| **Status** | Integrado com `PermissionsTree` (PERM-33) |
| **UI** | `src/components/AccessProfilesModule.tsx` |
| **Bridge** | `src/lib/accessProfilesTree.ts` |

## Estrutura

**Topo:** nome · descrição · role base · ativo · badge “Perfil de sistema” quando `isSystem`.

**Centro:** busca · expandir/recolher · árvore (módulo → página → aba → ação) com estado configurado e resultado do perfil.

**Rodapé fixo:** quantidade de alterações · cancelar · salvar perfil.

## Regras

- Snapshot: salvar o perfil **não** altera usuários já vinculados (aplicação só via “Aplicar”).
- Ações em lote **somente** no ramo selecionado, com confirmação visual.
- Após salvar: confirmação clara + dados recarregados (editor permanece aberto).

## Comandos

```bash
npm run test:access-profiles-matrix
npm run test:permissions-tree
```

## Evidência visual

- `docs/security/access-profiles-editor.preview.html`
- `docs/security/evidence/perm34-access-profiles-editor.png`
