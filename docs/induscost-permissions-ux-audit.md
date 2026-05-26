# IndusCost — Auditoria de UX da tela de Usuários e Permissões

> Fase: `INDUSCOST-ACCESS-PERMISSIONS-AUDIT-UX-A`.
>
> Foco: experiência do administrador ao gerenciar `AppUser` e permissões.

## 1. Localização

- Componente principal: `src/components/AdminUsersModule.tsx`
  (acessado em **Configurações → Usuários e Permissões**).
- Editor de permissões: `src/components/admin/PermissionEditor.tsx`
  (modal embutido por usuário).
- Picker de vendedor Nomus: `src/components/admin/SellerNomusPicker.tsx`.
- Endpoints administrativos: `/api/admin/users`, `/api/admin/permissions/catalog`,
  `/api/admin/seller-options`, `/api/admin/users/:id/reset-password`,
  `/api/admin/users/bootstrap-super-admin`.
- Gate de UI: `hasPermission("users.manage")` ou bootstrap admin
  (`requireUserAdminOrBootstrap`).

## 2. O que está BOM hoje

| #   | Item                                                                                            | Onde                                                         |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| B1  | Catálogo central de permissões com **label**, **descrição** e **risco**                          | `PERMISSION_CATALOG`                                          |
| B2  | Agrupamento por módulo (Geral, CRM, Engenharia, etc.) com contador e colapsar                   | `PermissionEditor` (rendering)                                |
| B3  | Busca textual com filtro em tempo real                                                          | `buildGroupTree(group, query)`                                |
| B4  | **Templates rápidos**: Vendedor, Gestor Comercial, Compras, Engenharia, Admin Sistema, Leitura  | `PERMISSION_TEMPLATES`                                        |
| B5  | Marcar grupo / Limpar grupo / Só visualização — atalhos práticos                                | `selectAllInGroup`, `clearGroup`, `selectViewOnlyForGroup`    |
| B6  | Badge de risco visual (Sensível/Crítica) com cor                                                | `riskBadgeLabel`                                              |
| B7  | Resumo do que está selecionado: total, grupos, críticas, módulos liberados                      | `summarizePermissionSelection`                                |
| B8  | Pais marcados automaticamente quando filho é selecionado                                        | `enablePermission` + `resolveRequiredChain`                   |
| B9  | Filhos limpos quando pai é desmarcado                                                           | `disablePermission` + `getAllDescendantKeys`                  |
| B10 | Whitelist no backend (`filterKnownPermissions`) evita gravar permissão inválida                 | `src/lib/appAuth.ts`                                          |
| B11 | `SUPER_ADMIN` é tratado especialmente: editor de permissões some, todas implícitas              | `AdminUsersModule:541`                                        |
| B12 | Aviso de **vínculo de vendedor obrigatório** quando perfil é `SELLER` ou tem `crm.seller.own`   | `sellerLinkWarning`                                           |
| B13 | Hint contextual por role no header do editor (SELLER / COMMERCIAL_MANAGER / SUPER_ADMIN)        | `AdminUsersModule:435-441`                                    |
| B14 | Tooltip em cada template explicando o objetivo                                                  | `title={PERMISSION_TEMPLATES[id].description}`                |
| B15 | Tabela com status (Ativo/Inativo), vendedor vinculado, último login e resumo das permissões    | `AdminUsersModule`                                            |

## 3. O que está RUIM / CONFUSO (antes desta fase)

| #   | Problema                                                                                                  | Severidade                       |
| --- | --------------------------------------------------------------------------------------------------------- | -------------------------------- |
| C1  | Botão "Inativar" funcionava no próprio usuário e nem o backend bloqueava                                  | P1 — risco de auto-bloqueio       |
| C2  | Era possível rebaixar o último `SUPER_ADMIN` ativo sem aviso                                              | P1 — risco de perda total de acesso |
| C3  | Era possível remover a própria `users.manage` (auto-bloqueio silencioso)                                  | P1 — risco de auto-bloqueio       |
| C4  | Sem badge "Você" para indicar visualmente o usuário logado                                                | P2 — confusão                     |
| C5  | Sem indicador "Único Super Administrador ativo" na linha do usuário                                       | P2 — confusão                     |
| C6  | Erro genérico "Erro ao atualizar usuário." sem detalhe quando o backend falhava                           | P2 — feedback ruim                |

## 4. O que está PERIGOSO (continua aberto após esta fase)

| #   | Problema                                                                                                  | Severidade | Plano                                       |
| --- | --------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------- |
| D1  | `/api/test-db` exibe contagens sem autenticação                                                           | P2         | Action plan: exigir `requireAppAuth`        |
| D2  | Sem log/auditoria de mudanças de role/permissões                                                          | P2         | Action plan: criar `AppUserChangeLog`       |
| D3  | Sem rate limit no `POST /api/auth/login` (a senha é forte, mas brute force ainda é possível)              | P3         | Action plan: rate limit por IP/email        |
| D4  | Não há expiração de senha nem força mínima além de 8 caracteres                                           | P3         | Action plan: política mínima de senha       |

## 5. O que FALTA (não bloqueante, oportunidades)

| #   | Oportunidade                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Ver "quem tem essa permissão" — clicar em uma permissão no editor e listar todos os usuários atuais. Útil em handover.                                  |
| F2  | Modo "comparar usuários" — escolher dois e ver o diff de permissões.                                                                                    |
| F3  | Indicador "Esta permissão não tem nenhum usuário" no catálogo (depende do banco).                                                                       |
| F4  | Exportar/importar lista de permissões/perfis em CSV ou JSON.                                                                                            |
| F5  | Histórico humano: timeline "Fulano alterou as permissões de Beltrano em DD/MM" — depende do `AppUserChangeLog`.                                         |
| F6  | "Convidar usuário" via e-mail (atualmente o admin precisa criar senha provisória manualmente).                                                          |
| F7  | Self-service: usuário trocar a própria senha sem precisar do admin.                                                                                     |

## 6. Riscos de usabilidade graves (todos endereçados por esta fase)

1. **Auto-bloqueio**: agora bloqueado em backend **e** UI quando o admin
   tenta inativar a si mesmo, rebaixar a si mesmo de SUPER_ADMIN ou
   remover a própria `users.manage`.
2. **Último Super Admin**: backend impede inativar/rebaixar; UI mostra
   badge "Único Super" e desabilita o botão Inativar com tooltip.
3. **Confusão "esse sou eu?"**: badge "Você" no nome.

## 7. Melhorias entregues nesta fase

1. **Backend** (`PATCH /api/admin/users/:id` em `server.ts`):
   - `409 CANNOT_DEACTIVATE_SELF` quando o admin tenta inativar a si mesmo.
   - `409 CANNOT_DEMOTE_SELF` quando o admin SUPER_ADMIN tenta sair do próprio role.
   - `409 CANNOT_REMOVE_OWN_USERS_MANAGE` quando o admin tenta remover sua própria `users.manage`.
   - `409 LAST_SUPER_ADMIN_PROTECTED` quando o alvo é o último SUPER_ADMIN ativo do sistema.
2. **Frontend** (`AdminUsersModule.tsx`):
   - Badge **Você** na linha do próprio usuário logado.
   - Badge **Único Super** na linha do único Super Admin ativo.
   - Botão **Inativar** desabilitado para o próprio usuário e para o último Super Admin (com tooltip explicando por quê).
   - Banner azul no editor quando se está editando o próprio usuário.
   - Lista de warnings antes do botão Salvar quando o usuário tenta uma operação que o backend vai bloquear.
   - Aviso amarelo quando o usuário em edição é o único Super Admin.
3. **Script** `npm run audit:permissions` (read-only) para regerar este
   diagnóstico a qualquer momento.

## 8. Roteiro de teste manual (UX)

1. Logado como Super Admin, abrir **Configurações → Usuários e Permissões**.
2. Confirmar que sua própria linha tem badge **Você**.
3. Se você é o único Super Admin ativo, confirmar que tem badge **Único Super** e
   o botão **Inativar** está desabilitado com tooltip claro.
4. Clicar **Editar** em si mesmo:
   - Banner azul "Você está editando seu próprio usuário."
   - Desmarcar `users.manage` → aparece alerta vermelho.
   - Tentar Salvar → mensagem específica do backend (não "Erro ao atualizar usuário.").
5. Trocar o próprio perfil de SUPER_ADMIN para ADMIN → alerta vermelho
   "rebaixar o próprio perfil". Salvar → 409 `CANNOT_DEMOTE_SELF`.
6. Cadastrar um segundo Super Admin → badge "Único Super" desaparece da primeira linha.
7. Editar **outro** usuário Super Admin → alerta amarelo só se for o último.
8. Templates: aplicar **Engenharia / Custos** em um usuário VIEWER e confirmar
   que o catálogo selecionado bate com `PERMISSION_TEMPLATES.engineering`.
9. Busca: digitar `bom` → só permissões com "bom" no nome/descrição/chave aparecem;
   pais ficam visíveis para preservar contexto.
10. Resumo: ao marcar `proposals.delete`, o card mostra "Sensíveis/críticas: Propostas — Excluir".
