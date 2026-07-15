# Roteiro de homologação — permissionamento (RC)

Ambiente: **homologação** (não produção). Contas de teste por persona.

## Preparação

1. Aplicar migrate + seed (ver runbook).
2. Confirmar `npm run permissions:validate` e `permissions:compare:legacy-vs-resource` = PASS.
3. Criar/atualizar usuários de teste:

| Conta | Persona |
|-------|---------|
| sa@… | SUPER_ADMIN |
| admin@… | ADMIN |
| gestor@… | COMMERCIAL_MANAGER |
| vendedor@… | SELLER |
| fin.ro@… | VIEWER + bag financeiro RO |
| fin.op@… | VIEWER + bag financeiro operacional |
| eng@… | VIEWER + bag engenharia |
| rh@… | VIEWER + bag RH |
| viewer@… | VIEWER limpo |
| deny@… | VIEWER só dashboard/pedidos |
| legado@… | VIEWER + opex/taxes/reports/materials |

## Roteiro (por conta)

Para cada persona:

1. **Login** — sessão ok; `permissions` / perfil exibidos.
2. **Sidebar** — itens conforme matriz (`permissions-persona-matrix.md`).
3. **URL direta** — path permitido carrega; path negado → Access Denied / redirect.
4. **Aba** — abas CRM / conciliação / comissões só as permitidas.
5. **Botão** — ações mutate ocultas ou 403.
6. **Endpoint direto** — Postman/curl com cookie da sessão → 200 ou 403 esperado.
7. **Exportação** — sem `*.export` / execute → bloqueada.
8. **Mutação** — criar/editar sem grant → 403.
9. **Deny** — confirma ausência de módulos sensíveis.
10. **Parent negado** — sem `finance.view` não abre filhos financeiros na nav.

Casos admin:

11. **Snapshot de perfil** — abrir usuário, matriz efetiva coerente.
12. **Aplicar perfil / role** — apply preset; dual-write sem perda de unmapped.
13. **Alteração individual** — override allow/deny; ordem deny > allow > role.
14. **Último SUPER_ADMIN** — UI/API impede remoção/demote do último.
15. **Auditoria** — `PermissionAuditLog` registra alteração.

## Critério de aceite homologação

- [ ] Zero acesso indevido nas personas de risco (vendedor/viewer/deny)
- [ ] SUPER_ADMIN e ADMIN não lockout
- [ ] Comparador legado→efetivo PASS no servidor de homolog
- [ ] Build/serviço saudáveis pós-restart
- [ ] Rollback ensaiado (documento lido pela operação)

**Não** declarar pronto para produção se qualquer checkbox crítico falhar.
