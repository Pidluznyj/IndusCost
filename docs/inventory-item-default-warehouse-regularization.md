# Estoque — almoxarifado padrão do item × conferência do tablet (2026-10-20)

Correção definitiva de itens recém-cadastrados que não apareciam na conferência física
do tablet (setor STANDARD `ADMINISTRATIVO`). Caso de referência: `ADM-INF-037` (Pilha A23 12V)
e outros 14 suprimentos administrativos cadastrados em 13/10/2026.

## 1. Causa raiz (confirmada no código)

| Onde | O quê |
| --- | --- |
| `src/lib/inventoryRoutes.ts` — `POST /api/inventory/items` (antes: linha ~607) | `prisma.inventoryItem.create` não recebia `defaultWarehouseId` nem `defaultLocationId`. |
| `src/lib/inventory/inventoryValidation.ts` — `parseCreateInventoryItemBody` | O contrato não aceitava os dois campos. |
| `src/components/inventory/inventoryItemForm.ts` / `InventoryItemDetailSheet.tsx` | O formulário não tinha o campo "Almoxarifado padrão"; o payload nunca o enviava. |
| `src/lib/inventory/collector/collectorStandardEligibility.ts` — `standardSectorMemberItemWhere` | Elegibilidade do setor = `ACTIVE` + `controlsStock` + `itemType` **e** (`defaultWarehouseId = almoxarifado do setor` **ou** saldo nesse almoxarifado). |
| `src/lib/inventory/collector/collectorStandardSector.server.ts` — `loadStandardSectorLineSeeds` | Duas leituras (saldos no almoxarifado + itens com padrão no almoxarifado). Item sem saldo e sem padrão não entra em nenhuma. |

Os itens de 09/10 tinham padrão porque foram criados pela carga inicial
(`administrativeStockInitialLoadApply.ts`, que grava `defaultWarehouseId`). Os de 13/10 foram
criados pela ficha, que não gravava. `populateStandardSectorCountLines` é idempotente: sessão com
linhas (ex.: `EST-20261020-004`, prefixo configurado no setor) não é repopulada — correto e preservado.

A conferência pela tela web (`startInventoryCountSession`, prefixo `CF-`) popula só por saldo; não
foi alterada (fora do escopo; ver riscos).

## 2. Regra de domínio implementada

Fonte única: `InventoryStockSector` (strategy `STANDARD`, `ACTIVE`) — o mesmo cadastro que o tablet lê.
Nada de código de almoxarifado fixo no código.

`src/lib/inventory/inventoryItemDefaultWarehousePolicy.ts` (pura) + `inventoryItemDefaultWarehouse.server.ts`:

| Tipo | Modo | Comportamento |
| --- | --- | --- |
| `RAW_MATERIAL` | `OFFICIAL_LINK` | Escopo é do vínculo com a MP oficial (`inventoryMaterialLinkService`, intacto). A ficha recusa o campo. |
| `COMPONENT`, `FINISHED_PRODUCT` | `PRESENCE` | Conferência por presença (saldo). Campo opcional e livre; nunca automático. |
| Tipo com **um** setor STANDARD ativo (ex.: `ADMINISTRATIVE_SUPPLY` → `ADMINISTRATIVO`) | `SECTOR_FIXED` | Omitido → preenchido com o almoxarifado do setor. Diferente → `DEFAULT_WAREHOUSE_INCOMPATIBLE_WITH_SECTOR`. Campo travado na ficha. |
| Tipo com **mais de um** setor | `SECTOR_CHOICE` | Obrigatório escolher entre os almoxarifados dos setores. |
| Tipo sem setor (ex.: EPI enquanto não houver setor de EPI) | `FREE` | Opcional, qualquer almoxarifado ativo. |

Validações no server (POST e PUT), independentes do frontend: almoxarifado existe, `ACTIVE`,
`allowsMovements` quando o item controla estoque; endereço existe, `ACTIVE` e pertence ao
almoxarifado; endereço sem almoxarifado infere o almoxarifado (e a política ainda vale).
Item com `materialId`: almoxarifado/endereço só pelo vínculo logístico (`DEFAULT_WAREHOUSE_MANAGED_BY_OFFICIAL_LINK`).

Novo endpoint `GET /api/inventory/items/default-warehouse-policy?itemType=` (permissão `inventoryItems.manage`),
usado pela ficha para pré-preencher/travar. Auditoria `CREATE` registra `reason` quando o almoxarifado veio da política.

Efeito colateral esperado no PUT: editar um item antigo sem padrão (tipo `SECTOR_FIXED`) grava o padrão
na primeira gravação — auditado no `UPDATE`.

## 3. Regularização dos itens existentes

`scripts/regularizeInventoryItemDefaultWarehouse.ts` (núcleo puro em
`src/lib/inventory/inventoryItemDefaultWarehouseRegularization.ts`).

```bash
npm run inventory:default-warehouse-regularization:dry
```

```bash
npm run inventory:default-warehouse-regularization:dry -- --itemType=ADMINISTRATIVE_SUPPLY --codes=ADM-PAP-100,ADM-MOB-013,ADM-MOB-014,ADM-MOB-015,ADM-MOB-016,ADM-MOB-017,ADM-FIX-096,ADM-FIX-097,ADM-FIX-098,ADM-FIX-099,ADM-INF-037,ADM-INF-038,ADM-INF-039,ADM-INF-040,ADM-INF-041
```

```bash
npm run inventory:default-warehouse-regularization:apply -- --actorUserId=<UUID> --confirm=REGULARIZE_INVENTORY_ITEM_DEFAULT_WAREHOUSE --itemType=ADMINISTRATIVE_SUPPLY
```

```bash
npx tsx scripts/regularizeInventoryItemDefaultWarehouse.ts --revert --report=reports/inventory-default-warehouse-regularization/apply-<stamp>.json --actorUserId=<UUID> --confirm=REGULARIZE_INVENTORY_ITEM_DEFAULT_WAREHOUSE
```

Critérios verificáveis (não a lista de códigos): `ACTIVE` + `controlsStock` + `defaultWarehouseId IS NULL`,
sem `materialId`, tipo com exatamente um setor STANDARD ativo cujo almoxarifado está `ACTIVE` e aceita
movimentações, e sem saldo/reserva ativa/bloqueio ativo em **outro** almoxarifado.

Classificações do diagnóstico (§6 do pedido), agrupadas por tipo no relatório: `ELIGIBLE`,
`OFFICIAL_LINK`, `PRESENCE_TYPE`, `NO_SECTOR` (cadastro em preparação / tipo sem conferência),
`AMBIGUOUS_SECTOR`, `CONFLICT_LINKED_ELSEWHERE`, `TARGET_WAREHOUSE_INVALID`, `NOT_SELECTED` (fora dos filtros).

Garantias: dry-run padrão (só grava JSON em `reports/…`); apply em transação única, plano
recalculado dentro da transação, escrita CAS (`updateMany where defaultWarehouseId IS NULL`),
`InventoryAuditLog` por item (`SET_DEFAULT_WAREHOUSE_REGULARIZATION`, before/after/reason);
idempotente (segunda rodada: 0 elegíveis); nunca toca saldo, movimento, sessão ou linha de conferência.
Rollback: `--revert` com o JSON do apply desfaz só o que ainda está exatamente como foi gravado
(`REVERT_DEFAULT_WAREHOUSE_REGULARIZATION`).

## 4. Conferência do tablet

Sem mudança no motor: a elegibilidade já incluía "padrão no almoxarifado do setor, mesmo sem saldo".
Após a regularização, a **próxima** sessão do setor inclui os itens com quantidade sistêmica 0.
Sessões `COUNTING` (ex.: `EST-20261020-004`) continuam como estão — o tablet reaproveita a sessão
ativa e não a repopula. Sessões `APPROVED`/`ADJUSTED`/`CANCELED` não são tocadas.
O tablet lista só `InventoryCountLine` da sessão (`GET …/count-sessions/:id/items`); não há cache
local (`localStorage`/IndexedDB) — testado por fonte.

## 5. Testes

- `src/lib/inventory/inventoryItemDefaultWarehousePolicy.test.ts` — política pura, resolvedor server (dublê), contrato de validação, rotas (fonte), auditoria.
- `src/lib/inventory/inventoryItemDefaultWarehouseRegularization.test.ts` — classificação dos 15 códigos e dos demais tipos, conflitos, filtros, apply/CAS/auditoria, idempotência, reversão, CLI (fonte).
- `src/lib/inventory/collector/collectorStandardSector.test.ts` — bloco "itens novos × sessões": sessão antiga preservada, nova sessão inclui item sem saldo / com saldo / múltiplos endereços, repopulação idempotente, contrato do tablet.
- `src/lib/inventoryItems.test.ts` — formulário: payload, validação endereço×almoxarifado, aplicação da política, ficha (fonte).

```bash
DATABASE_URL=postgresql://offline:offline@127.0.0.1:1/offline npx tsx --test src/lib/inventory/inventoryItemDefaultWarehousePolicy.test.ts src/lib/inventory/inventoryItemDefaultWarehouseRegularization.test.ts src/lib/inventory/collector/collectorStandardSector.test.ts src/lib/inventoryItems.test.ts
```

## 6. Publicação e regularização na AWS (após aprovação)

Sem migration (colunas já existem). Sem seed de permissão (reusa `inventoryItems.manage`).

1. Homologação: deploy do código; cadastrar um suprimento administrativo pela ficha e confirmar
   `defaultWarehouseId = ADMINISTRATIVO` (campo já vem preenchido e travado).
2. Homologação: `…:dry` → conferir a lista `ELIGIBLE` (esperado: os 15 códigos, `ADMINISTRATIVE_SUPPLY`,
   `[já tem saldo]` ausente) e o diagnóstico por tipo; `…:apply` com `--itemType=ADMINISTRATIVE_SUPPLY`;
   rodar `…:dry` de novo (esperado: 0 elegíveis).
3. Homologação: abrir uma **nova** sessão do setor no tablet (a `COUNTING` atual precisa ser
   finalizada/aprovada ou cancelada pelo fluxo oficial — nunca editada à mão) e verificar que os
   15 itens aparecem com quantidade a contar; a sessão anterior permanece com 311 linhas.
4. Produção, só com autorização expressa: mesmo roteiro (dry → apply → dry), guardando o JSON do apply
   para eventual `--revert`. Não executar SQL manual; não recriar `EST-20261020-004`.

## 7. Riscos e limitações

- Tipos sem setor STANDARD (ex.: EPI hoje) continuam sem padrão automático — por desenho (`FREE`).
  Ao criar o setor de EPI, novos cadastros passam a ser travados nele; os antigos entram pelo mesmo
  script (`--itemType=PPE`).
- Conferência pela tela web (`CF-`) continua populando só por saldo; itens novos sem saldo só
  aparecem na conferência do tablet. Não alterado nesta entrega.
- A ficha agora envia `defaultWarehouseId` no PUT: um item antigo sem padrão ganha o padrão na
  primeira edição (auditado).
- Typecheck: a base já tem ~1371 erros conhecidos; a entrega não adiciona nenhum.
