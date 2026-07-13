# Relatório QA visual — Usuários e Permissões

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-13 |
| **Tela** | Admin → Usuários e Permissões (`AdminUsersModule`) |
| **Escopo** | Usabilidade / visual / estados — sem mudança de regra de backend nem cálculo de negócio |
| **Conclusão** | **LIBERADO** com ajustes de copy e estados aplicados neste ciclo |

---

## Status por categoria

| # | Verificação | Status | Evidência |
|---|-------------|--------|-----------|
| 1 | Layout limpo | ✅ Pass | Workbench 2 colunas + abas Usuários / Resumo por perfil; hierarquia visual clara |
| 2 | Cards alinhados | ✅ Pass | Lista + painel detalhe em `rounded-xl border`; SummaryCards em grid `sm:grid-cols-2` com altura consistente |
| 3 | Árvore legível | ✅ Pass | Labels PT (Menu/Submenu/Aba/Ação), badge **Personalizado**, checkboxes Ver/Executar/Gerenciar com tooltip |
| 4 | Busca | ✅ Pass | Busca de usuários + busca na árvore (`filterTreeBySearch`); empty state de busca |
| 5 | Expandir/recolher | ✅ Pass | Botões **Expandir tudo** / **Recolher tudo** + chevron por nó |
| 6 | Botões rápidos | ✅ Pass | Liberar 1º menu, Limpar personalizações, Restaurar padrão do perfil |
| 7 | Alterações pendentes | ✅ Pass | Badge âmbar **Alterações pendentes** na barra inferior |
| 8 | Salvar/cancelar | ✅ Pass | Cancelar restaura draft; Salvar chama API de overrides |
| 9 | Restaurar padrão | ✅ Pass | Confirmação em PT + `restoreUserRoleDefault` |
| 10 | Limpar personalização | ✅ Pass | Confirmação em PT + `clearUserPermissionOverrides` |
| 11 | SUPER_ADMIN protegido | ✅ Pass | Árvore read-only + aviso em português (não usa código cru `SUPER_ADMIN` na mensagem) |
| 12 | Último SUPER_ADMIN | ✅ Pass | Select de perfil desabilitado + mensagem de bloqueio |
| 13 | Mobile/tablet | ✅ Pass / razoável | Grid empilha em `<lg`; toolbar e flags da árvore empilham em `sm`; touch targets ≥ ~28px |
| 14 | Dark/light | ⚠️ N/A parcial | UI usa tokens `border-border` / `bg-card` / `text-muted-foreground` (tema do app); sem `dark:` explícito nesta tela |
| 15 | Estados | ✅ Pass | loading, empty, erro, sem permissão, usuário não selecionado, erro de detalhe com “Tentar novamente” |
| 16 | Mensagens em PT | ✅ Pass | Confirms, erros, labels e auditoria revisados |
| 17 | Sem JSON cru | ✅ Pass | Resumo/diff/auditoria formatados; sem dump de payload |
| 18 | Sem jargão desnecessário | ✅ Pass | Evitado role/preset/override/Custom/MENU crus na UI final |

---

## Testes feitos (código / revisão)

- Revisão estática de `AdminUsersModule.tsx`, `UserPermissionTree.tsx`, `RolePermissionMatrixPanel.tsx`.
- Ajustes de copy e estados vazios.
- Unit: `userPermissionsAdminUi` (rótulos) + `permissionAudit` (labels amigáveis).
- Gates: `check:frontend-server-imports`, `check:server-imports`, `npm test`, `npm run build`, `check:browser-bundle`.

> QA visual interativo no browser não foi executado neste ambiente (sem sessão admin autenticada). Itens 1–18 cobertos por inspeção de código + melhorias aplicadas.

---

## Ajustes feitos neste ciclo

- Labels: “perfil”, “personalizado”, “padrão do perfil”; tipos Menu/Submenu/Aba/Ação.
- Diff do resumo: texto humano (`Ver · Gerenciar`) em vez de `V1E0G0`.
- Auditoria: “Alterado por”, “Área” com label amigável; ações sem “Override/Preset/Role”.
- Estados vazios reforçados (lista, seleção, busca na árvore, auditoria, sem permissão).
- Badge de alterações pendentes mais visível; barra de ações responsiva.
- Avisos SUPER_ADMIN / último Super Admin em português claro + tooltip no select.

---

## Falhas encontradas

Nenhuma falha bloqueante de usabilidade após os ajustes.

---

## Pendências reais

- Validação visual manual em staging com usuário `users.manage` (checklist click-through).
- Tema dark dedicado: depende do design system global; esta tela já usa tokens semânticos.
- Hierarquia ideal Menu→Submenu→Aba em comissões (ver relatório técnico `permissions-qa-report.md`) — fora do escopo UI.

---

## Conclusão

**LIBERADO** para uso da nova tela de Usuários e Permissões do ponto de vista de usabilidade/copy/estados, após os ajustes deste PR.
