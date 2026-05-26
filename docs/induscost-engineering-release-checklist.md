# IndusCost — Checklist de release para a Engenharia (segunda-feira)

> Use este documento como roteiro de validação **antes** de liberar a
> Central de Engenharia Nomus para uso da equipe. Tudo aqui é
> reproduzível e seguro. Apply real é opcional e **pede backup**.

## 0. Pré-requisitos no servidor

- [ ] Acesso SSH ao host de `/opt/induscost`.
- [ ] Acesso `psql` ao banco `teste_bi`.
- [ ] Permissão para reiniciar app (`pm2` ou `systemctl`).
- [ ] Espaço em disco suficiente para um `pg_dump` (~5–10 % do tamanho do banco).

## 1. Atualizar código e dependências

```bash
cd /opt/induscost
git pull --rebase origin main
npm install                 # se houver mudança em deps (esta release não tem)
npx prisma generate         # garante client atualizado mesmo sem migration
```

Esperado: `git pull` traz pelo menos `7c57130 feat(nomus): prepare engineering release workspace`.

## 2. Validações técnicas (read-only)

```bash
npm run check:frontend-imports
npm run lint
npm run build
```

Saída esperada:
- `check:frontend-imports` → `OK — 108 arquivo(s) frontend escaneado(s)`.
- `lint` → exit 0 sem mensagens.
- `build` → 1 warning de chunk size (esperado), **sem** menção a
  `.prisma/client/index-browser` e **sem** `duplicate key`.

## 3. Smoke tests Nomus (read-only)

> Todos têm snapshot antes/depois e checagem de FK órfã. Nenhum aplica
> mudança no banco.

```bash
npm run test:nomus:master-data-import
npm run test:nomus:master-data-equalize
npm run test:nomus:engineering-action-plan
npm run test:nomus:engineering-release-check
npm run test:nomus:bom-apply-after-master-data
npm run test:nomus:auto-sync-bom-apply
npm run test:nomus:engineering-release-ready
```

Saída esperada para cada: linha final `OK — ... read-only concluído`.
Qualquer `FALHA` interrompe a release; investigar antes de seguir.

## 4. Previews / diagnósticos (read-only)

```bash
npm run sync:nomus:master-data-diagnostic
npm run sync:nomus:master-data-preview
npm run sync:nomus:master-data-equalize-preview

npm run sync:nomus:bom-apply-preview -- --parentCode=611.48AA
npm run sync:nomus:bom-apply-preview -- --parentCode=304.02AA
npm run sync:nomus:bom-apply-preview -- --parentCode=610.73BA
npm run sync:nomus:bom-apply-preview -- --parentCode=610.75BA
npm run sync:nomus:bom-apply-preview -- --parentCode=317.02AA
```

Para cada preview, conferir:
- `confirmationRequiredText` no formato `APLICAR BOM NOMUS <SKU>`.
- `canApply` coerente (com bloqueio explicado em `blockingDetails` se
  `false`).
- Nenhum delete inesperado (`actionType=REMOVE_PRODUCT_BOM_LINE` só para
  componentes Nomus saindo, **nunca** para 800.xx).

## 5. Diagnóstico do banco (FK órfã)

```bash
runuser -u postgres -- psql -d teste_bi -P pager=off -c "
SELECT COUNT(*) AS logs_com_runid_orfao
FROM \"EngineeringChangeLog\" l
LEFT JOIN \"EngineeringSyncRun\" r ON r.id = l.\"runId\"
WHERE l.\"runId\" IS NOT NULL
  AND r.id IS NULL;
"
```

Esperado: `logs_com_runid_orfao = 0`.

## 6. Restart da aplicação

```bash
pm2 restart induscost
# ou:
sudo systemctl restart induscost.service
```

Confirmar logs limpos por 30 segundos:

```bash
pm2 logs induscost --lines 60 --nostream
# ou:
sudo journalctl -u induscost.service -n 60 --no-pager
```

Não pode aparecer:
- `Foreign key constraint violated`
- `global is not defined`
- 500 nas rotas Nomus

## 7. Validação visual

> Acessar o sistema em aba anônima ou após `Ctrl+F5` para evitar cache.

### 7.1 Login
- [ ] `/login` renderiza, formulário aparece, sem tela branca.
- [ ] Console do navegador sem erro vermelho.

### 7.2 Manutenção Nomus → Visão Geral (sem produto)
- [ ] Painel **Central de Engenharia Nomus — Resumo** aparece.
- [ ] Clicar **Atualizar painel da engenharia** carrega 8 cards de status.
- [ ] 3 cards inferiores mostram "Última Igualar bases", "Última
      aplicação de BOM" e "Último backfill" (ou texto "ainda não há").
- [ ] Abaixo, painel **Carga Mestre Nomus** com 3 botões.
- [ ] Abaixo, **Central de Atualização Nomus** carrega.

### 7.3 Manutenção Nomus → Visão Geral (com produto 611.48AA)
- [ ] No topo aparece **Checklist de liberação para custeio** com 8 itens.
- [ ] Maioria em **OK**. Item "Histórico registrado" pode estar **Pendente**.
- [ ] Abaixo, resumo do produto + atalhos para BOM efetiva, Impacto,
      Plano, Diagnóstico.

### 7.4 Produto → aba Histórico
- [ ] Abrir o produto em **Produtos**.
- [ ] Aba **Histórico** existe e carrega.
- [ ] Para produtos já tocados pelo Igualar Bases: aparecem entries
      `IMPORTED` (cinza/azul) e `EQUALIZED` (violeta).

### 7.5 Aplicar BOM Nomus (UI)
- [ ] Painel **Aplicar BOM Nomus** mostra `confirmationRequiredText`
      no formato `APLICAR BOM NOMUS 611.48AA`.
- [ ] Botão **Aplicar** desabilitado enquanto não digitar a frase exata.
- [ ] Após digitar, aplicação retorna mensagem clara e atualiza BOM
      efetiva/Impacto/Histórico.

### 7.6 Botões perigosos
- [ ] Nenhum botão "Aplicar todos" ou "Aplicar em lote" visível na UI
      (a fase atual proíbe).

## 8. Pilotos com dados reais

Ordem sugerida para os primeiros applies:

| Sku | Por que primeiro |
|---|---|
| **611.48AA** | Já validado, `readiness=NO_ACTION_REQUIRED` (deve dar `NO_CHANGES`). |
| **304.02AA** | Mais recente caso bloqueado por `110.03--` que a Carga Mestre destravou. |
| **317.02AA** | Caso `FINISHING_SERVICE` — confere se a UI distingue. |
| **610.73BA** | Caso com montagem local e opcionais — atenção a 800.01. |
| **610.75BA** | Caso de duplicidade `420.01A-` — preview deve gerar `CONSOLIDATE` ou `BLOCKED`. |

## 9. Apply real (opcional, com backup)

> Só rode quando tudo das seções anteriores estiver verde.

### 9.1 Backup
```bash
TS=$(date +%Y%m%d_%H%M%S)
pg_dump -Fc -d teste_bi > /tmp/backup_pre_release_${TS}.dump
echo "Backup gravado em /tmp/backup_pre_release_${TS}.dump"
ls -lh /tmp/backup_pre_release_${TS}.dump
```

### 9.2 Backfill de histórico
> Idempotente. Pode rodar até em produtos que já têm histórico.

```bash
npm run sync:nomus:master-data-history-backfill                    # dry-run
npm run sync:nomus:master-data-history-backfill -- --confirm="BACKFILL HISTORICO NOMUS"
```

### 9.3 Apply BOM em piloto
```bash
npm run sync:nomus:bom-apply-one -- --parentCode=611.48AA --confirm="APLICAR BOM NOMUS 611.48AA"
npm run sync:nomus:bom-apply-one -- --parentCode=304.02AA --confirm="APLICAR BOM NOMUS 304.02AA"
```

### 9.3b Auto apply BOM após sync Nomus (rotina automática)

Fase: `NOMUS-AUTO-SYNC-APPLY-BOM-TRUTH-A`.

Após `npm run sync:nomus:all:apply` (ou rotina diária `runNomusDailySync.sh apply`):

1. Conferir relatório: `docs/generated/nomus-auto-sync-bom-apply-report.md`
2. Validar piloto 307.05AA:

```bash
npm run sync:nomus:bom-apply-preview -- --parentCode=307.05AA
```

Esperado: `canApply=true`, ações majoritariamente `KEEP_PRODUCT_BOM_LINE`,
sem `UPDATE_PRODUCT_BOM_QUANTITY` pendente.

3. Conferir ProductBOM:
   - `115.01--` = `0.001268`
   - `121.16--` = `0.000033`
4. Histórico: entries com `changeOrigin=NOMUS_SYNC`, `changedBy=nomus-auto-sync`.

Comando manual (fora do orquestrador):

```bash
npm run sync:nomus:bom-auto-apply              # dry-run
npm run sync:nomus:bom-auto-apply -- --apply   # aplica todos os elegíveis
```

Cada apply imprime `--- RESUMO ---` com `status`, contagens e `runId`.
Conferir no banco:

```sql
SELECT id, status, "planHash", "summaryJson"::text
FROM "EngineeringSyncRun"
ORDER BY "createdAt" DESC
LIMIT 5;
```

### 9.4 Conferência cruzada na UI
- [ ] Após o apply, abrir o produto e ver aba **Histórico**: nova entry
      `EQUALIZED` ou `@bom_line_*` aparece com `runId` clicável.
- [ ] Painel BOM efetiva mostra a estrutura atualizada.
- [ ] Painel Impacto mostra `hasStructuralChanges=false` e delta zero
      (para 611.48AA).

## 9b. Reclassificação de item (Produto / Componente / Material)

Fase: `INDUSCOST-ITEM-RECLASSIFICATION-WORKFLOW-A`.

1. Abrir o módulo **Produtos** → **Editar Engenharia** em um produto
   conhecido sem propostas/pedidos/preço.
2. Na aba **Informações**, clicar no botão **Componente** (item está
   como Produto). Esperado:
   - Modal **Reclassificar item** abre.
   - Cards mostram contagens reais de dependência (BOM, roteiro,
     pricing, propostas, pedidos, tabela de preço, Nomus, histórico).
   - Status `ALLOWED` ou `REQUIRES_CONFIRMATION`.
   - Texto exigido: `RECLASSIFICAR ITEM`.
3. Digitar o texto e confirmar. Esperado:
   - Lista atualiza com badge `Componente`.
   - Histórico do produto registra entry com `fieldName=type`,
     `oldValue=PRODUCT`, `newValue=COMPONENT`, origem `MANUAL_EDIT` e
     `reason` começando com `ITEM_RECLASSIFICATION:`.
4. Repetir para um produto **com** propostas/pedidos. Esperado:
   - Modal abre como `REQUIRES_CONFIRMATION` com warning
     `HAS_HISTORY` — propostas/pedidos não são apagados.
5. Tentar **Produto → Material** num item com BOM. Esperado:
   - Modal abre como `BLOCKED` com motivo `BOM_AS_PARENT_PRESENT`.
   - Nenhuma alteração é gravada.
6. Tentar **Produto → Material** num item realmente órfão. Esperado:
   - Status `REQUIRES_CONFIRMATION`; texto exigido
     `RECLASSIFICAR PARA MATERIAL <SKU>`.
   - Após confirmar: novo `Material.code = SKU` criado, Product
     original `status=INACTIVE`, duas entries em
     `EngineeringChangeLog` (uma `PRODUCT @reclassified_to_material`,
     outra `MATERIAL @created_from_product`).
7. Em qualquer aba do modal, nenhum alert genérico
   `"Erro ao atualizar produto."` deve aparecer.

```sql
-- Auditoria das reclassificações nas últimas 24h
runuser -u postgres -- psql -d teste_bi -P pager=off -c "
  select \"changedAt\", \"productSku\", \"fieldName\",
         \"oldValue\", \"newValue\", reason
    from \"EngineeringChangeLog\"
   where reason like 'ITEM_RECLASSIFICATION:%'
     and \"changedAt\" > now() - interval '24 hours'
   order by \"changedAt\" desc
   limit 50;
"
```

## 9c. Permissões e controle de acesso

Fase: `INDUSCOST-ACCESS-PERMISSIONS-AUDIT-UX-A`.

```bash
npm run audit:permissions
```

Saída esperada (resumo):

- `catálogo=73 | observadas=73 | órfãs<=5 | fantasmas=0 | somente_fe<=2 | somente_be<=26`
- `rotas=179 | sem permissão direta=9 | mutations sem permissão=4`
- Relatório gravado em `docs/generated/permissions-audit-report.md`.
- O número de **fantasmas deve sempre ser 0**. Qualquer aumento
  indica que alguém usou uma string de permissão fora do catálogo.

Validação manual da tela **Configurações → Usuários e Permissões**:

1. [ ] Logar como Super Admin. Sua linha tem badge **Você**.
2. [ ] Cadastrar um VIEWER de engenharia (template **Engenharia /
       Custos**). Confirmar que ele acessa BOM/custo mas **não** acessa
       Configurações/Usuários e **não** vê botão Excluir item.
3. [ ] Cadastrar um VIEWER somente leitura (template **Somente Leitura**).
       Confirmar que ele acessa propostas em modo consulta e **não** vê
       botão Editar.
4. [ ] Cadastrar um usuário com `users.manage` (ADMIN). Confirmar que
       ele acessa Usuários e Permissões, mas **não** consegue inativar a
       si mesmo (`409 CANNOT_DEACTIVATE_SELF`) nem rebaixar (se for o
       último Super) o último Super Admin.
5. [ ] Sendo o único Super Admin ativo, tentar inativar sua própria
       conta pelo botão da lista → botão desabilitado com tooltip;
       tentar via edição do form → backend devolve
       `409 LAST_SUPER_ADMIN_PROTECTED`. Tentar remover sua própria
       `users.manage` → backend devolve `409 CANNOT_REMOVE_OWN_USERS_MANAGE`.
6. [ ] Aplicar **Modelos rápidos** (`Vendedor`, `Compras`, `Engenharia`,
       `Admin Sistema`, `Leitura`) — verificar que a seleção bate com
       `PERMISSION_TEMPLATES`.
7. [ ] Buscar `bom`, `custo`, `nomus` — busca filtra catálogo
       preservando pais.

## 10. Critérios de aceite final

A versão está **aceita para Engenharia** quando todos os checkboxes
desta lista estão marcados:

- [ ] Seção 2 (build) verde.
- [ ] Seção 3 (smokes) toda verde.
- [ ] Seção 4 (previews) todos respondem.
- [ ] Seção 5 (FK órfã = 0).
- [ ] Seção 6 (restart limpo).
- [ ] Seção 7.1–7.5 visualmente OK.
- [ ] (Se rodado) 9.3 com `status=APPLIED` ou `NO_CHANGES` e nenhum
      `FAILED`.
- [ ] Seção 9b: reclassificação mostra análise de impacto, exige
      confirmação textual, registra histórico e nunca exibe
      `"Erro ao atualizar produto."` genérico.
- [ ] Seção 9c: `npm run audit:permissions` verde, fantasmas=0,
      auto-bloqueio impedido, último Super Admin protegido.

## 11. Plano de rollback

Se algum passo da seção 9 falhar:

```bash
# 1. Parar a aplicação
pm2 stop induscost   # ou: sudo systemctl stop induscost.service

# 2. Restaurar do backup
runuser -u postgres -- pg_restore --clean --if-exists --no-owner --dbname=teste_bi /tmp/backup_pre_release_${TS}.dump

# 3. Reverter código se for o caso (commit anterior conhecido como bom)
git -C /opt/induscost log --oneline -5
git -C /opt/induscost checkout <commit_anterior>
npm install
npx prisma generate
npm run build

# 4. Subir aplicação
pm2 start induscost   # ou: sudo systemctl start induscost.service
```

## 12. O que **não** fazer

- ❌ Não rodar `nomusMasterDataImportApplySafeV1` com `--confirm` sem
  ter rodado o `--preview` antes.
- ❌ Não rodar `nomusMasterDataEqualizeApplyV1` em ambiente sem backup.
- ❌ Não rodar `nomusBomApplyOneV1` para produto com `canApply=false`
  no preview.
- ❌ Não rodar `apply-api-permission-guards.mjs` (script utilitário
  histórico — usar só sob orientação).
- ❌ Não modificar `prisma/schema.prisma` para tentar limpar tabelas
  `_backup_*_20260413` neste momento — entra em fase específica
  (`INDUSCOST-LEGACY-BACKUP-CLEANUP-A`).
- ❌ Não rodar `pricing/apply-batch` na UI até a fase de hardening
  (`INDUSCOST-PRICING-APPLY-GUARDRAIL-A`).

## 13. Lista de fases futuras priorizadas

(Ver `induscost-action-plan-roadmap.md` para o detalhamento.)

1. `INDUSCOST-MASTER-DATA-IMPORT-HISTORY-A` (P1)
2. `INDUSCOST-PRICING-APPLY-GUARDRAIL-A` (P1)
3. `INDUSCOST-FRONTEND-LAZY-LOAD-A` (P2)
4. `INDUSCOST-CROSS-MODULE-SMOKES-A` (P2)
5. `INDUSCOST-COST-GRID-MODAL-CHECK-A` (P2)
6. `NOMUS-ENGINEERING-RELEASE-INDICATORS-A` (P2)
7. `INDUSCOST-SERVER-ROUTES-SPLIT-A` (P1, refactor)
8. `INDUSCOST-LEGACY-BACKUP-CLEANUP-A` (P1, com migration aprovada)
9. `INDUSCOST-API-INPUT-VALIDATION-A` (P2)
10. `INDUSCOST-SIMULATION-LEGACY-AUDIT-A` (P2)
11. `INDUSCOST-LEGACY-SCRIPTS-MOVE-A` (P3)
12. `INDUSCOST-INAPP-GUIDE-REFRESH-A` (P3)
13. `INDUSCOST-INTEGRATION-RUN-AUDIT-A` (P3)
