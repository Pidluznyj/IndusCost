# Stock Collector — fluxo autônomo por setor

## Objetivo

Permitir que um tablet no tailnet inicie e conclua a contagem física de
**Matéria-prima**, **Componentes** e **Produto acabado** sem login humano falso:
identidade = `DEVICE` + `deviceId` do Device Registry (Tailscale StableID).

Retirada de material pelo tablet continua **só** em Matéria-prima.

## QR GERAL DE SETOR (deep-link)

O QR operacional da fase autônoma **não** é um QR por produto: é o deep-link do
setor, e nada mais.

| | |
|---|---|
| Setores | `RAW_MATERIAL` → `raw-material` (MP-) · `COMPONENT` → `componentes` (CP-) · `FINISHED_PRODUCT` → `produto-acabado` (PA-) |
| Path | `/collector/sector/raw-material` · `/collector/sector/componentes` · `/collector/sector/produto-acabado` |
| Conteúdo do QR | a URL **absoluta**, ex. `https://<host>/collector/sector/raw-material` |
| Leitura | câmera **nativa** do iPad → Safari (sem scanner interno, sem BarcodeDetector) |
| Autorização | Tailscale peer + `InventoryCollectorDevice` ACTIVE, 100% server-side |

O QR **não é credencial**: fotografá-lo ou copiar a URL não dá acesso a nada. Ele
não carrega `deviceId`, StableID, `userId`, `actorType`, token, `sessionId` nem
`itemId`/`warehouseId`/`locationId` — nem querystring, nem fragmento.

### Configuração obrigatória

```
INVENTORY_COLLECTOR_PUBLIC_BASE_URL=https://<host-acessivel-pelo-ipad>
```

`APP_URL` continua valendo como **fallback** quando a variável principal está
ausente ou vazia. Regras da base (`collectorPublicBaseUrl.ts`, fail-closed):

- `https://` é o padrão operacional;
- `http://` só em loopback (`localhost`, `127.0.0.1`, `[::1]`), para dev local —
  HTTP remoto é recusado;
- credencial embutida (`user:pass@`), query string e fragmento são recusados;
- subpath de reverse proxy (`https://host/app`) é preservado;
- barra final não duplica `//`.

Sem base válida o servidor **não** emite QR: `buildSectorCollectorAbsoluteUrl`
lança `COLLECTOR_PUBLIC_BASE_URL_REQUIRED` (nada configurado) ou
`COLLECTOR_PUBLIC_BASE_URL_INVALID` (valor inutilizável). Um path relativo
serviria como rota interna e seria **inútil** dentro de um QR impresso — por isso
nunca é emitido.

### Endpoint humano

`GET /api/inventory/collector/sector-qr?sector=RAW_MATERIAL` — login +
`inventoryCounts.manage` (`countManage`). Continua sendo endpoint HUMANO: um
tablet não autenticado não gera QR administrativo.

- `200` → `{ sector, label, url }` com `url` absoluta
- `401` / `403` → sem sessão ou sem permissão
- `503` + `code` → configuração da base pública ausente/inválida

`InventoryCountLabelsPage` distingue os quatro casos: 401/403 apenas oculta o QR
administrativo; erro de configuração aparece como aviso explícito citando a
variável; falha de rede/backend aparece como erro. **Nada é ocultado em
silêncio**, e configuração ausente nunca é apresentada como "dispositivo não
autorizado".

### Emissão na aba Dispositivos do Coletor (botão + modal)

Em Estoque → Dispositivos do Coletor, a seção "QR de acesso ao Collector"
**não** mostra o QR inline: o operador escolhe o setor (lista derivada de
`COLLECTOR_SECTORS`, via `COLLECTOR_SECTOR_QR_OPTIONS`) e clica em **Emitir QR
do setor**; o QR abre em um modal (`Overlay`) com a mesma folha canônica de
Estoque → Etiquetas QR em pré-visualização, a URL, **Abrir Collector** e
**Imprimir QR** (A4 retrato, mesmo print-root de antes).

**QR fixo por setor.** O conteúdo é o deep-link determinístico do setor —
sem token, data, sessão ou aleatoriedade —, logo emitir de novo produz
exatamente o mesmo QR (teste de determinismo em
`InventoryCollectorSectorQrSection.test.tsx`). Por isso a UI não oferece
"Atualizar/Regenerar": a aba guarda o QR emitido por setor e reemitir só
reabre o modal; a única ação de nova chamada é **Tentar novamente** após
erro de rede/servidor. O único evento que altera o QR de um setor é a
mudança da base pública (`INVENTORY_COLLECTOR_PUBLIC_BASE_URL`), que é uma
decisão de infraestrutura — nesse caso as folhas fixadas precisam ser
reimpressas. Não há persistência de QR em banco de propósito: um QR
"congelado" em tabela apontaria para um host antigo depois de uma troca de
base e deixaria de abrir o Collector.

### Não confundir com o QR legado

| | QR de setor (novo) | QR `inv-loc` (legado) |
|---|---|---|
| Fluxo | `/collector/sector/raw-material` | `/collector` |
| Conteúdo | URL absoluta (deep-link) | JSON `{v,t:"inv-loc",itemId,warehouseId,locationId}` |
| Leitor | câmera nativa do iPad | `CollectorQrScanner` (BarcodeDetector) |
| Resolução | nenhuma — é só um link | `POST /api/inventory/collector/resolve-qr` |

Os dois contratos **não são intercambiáveis**. O QR de setor não passa por
`resolve-qr` e não carrega IDs internos; o legado (`collectorQrContract`) segue
intacto para etiquetas por item.

## Capacidades do device (migration aditiva)

Em `InventoryCollectorDevice`:

- `canManageCountSessions` (default `true`) — criar/continuar/finalizar
- `canApplyCountAdjustments` (default `true`) — gerar ajustes canônicos

## API DEVICE (`deviceAuth`)

| Método | Rota | Notas |
|---|---|---|
| GET | `/api/inventory/collector/context?sector=RAW_MATERIAL` | device + warehouses + activeSession |
| GET | `/api/inventory/collector/count-sessions/active` | sessão COUNTING do warehouse |
| POST | `/api/inventory/collector/count-sessions` | create+start idempotente (`MP-`/`CP-`/`PA-YYYYMMDD-NNN`) |
| GET | `/api/inventory/collector/count-sessions/:id/items` | lista **cega** (sem systemQuantity) |
| POST | `/api/inventory/collector/count` | wrapper DEVICE → `recordInventoryCount` |
| POST | `/api/inventory/collector/count-sessions/:id/finalize` | `allowUncounted`; auto-justificativa DEVICE; auto-approve |
| POST | `/api/inventory/collector/count-sessions/:id/apply-adjustments` | `confirm` + `operationId`; idempotente |

Rotas legadas (resolve-qr / PATCH lines / list COUNTING) são preservadas.

Contexto, sessão ativa e criação despacham por setor na borda
(`collectorRoutes.server.ts`): MP segue o código de MP; Componentes e Produto
acabado usam `collectorProductSectorCounting.server.ts`. Sessão COUNTING
incompatível → **409** `COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE`.

## População RAW_MATERIAL (MP)

Batch (sem N+1):

1. Materials ACTIVE (diagnóstico)
2. InventoryItems ACTIVE com `materialId` + `RAW_MATERIAL` (saldos do warehouse + defaultWarehouse)
3. InventoryBalances do warehouse
4. Linhas com `systemQuantity` do físico; item sem saldo → linha com `0`

Idempotente se a sessão já tiver linhas. Não cria motor paralelo nem atualiza
`InventoryBalance` / `Material.quantity` diretamente.

## Componentes e Produto acabado

Fluxo irmão do de MP (`collectorProductSectorCounting.server.ts`) — o código de
MP não foi generalizado e continua recusando esses setores.

- **Identidade:** Product → `productId` → `InventoryItem.itemType`. Nunca `materialId`.
- **Elegível:** InventoryItem **já existente**, `ACTIVE`, `itemType` do setor,
  `productId` preenchido, `controlsStock = true`. Nada é criado: nem Product,
  Material, BOM, InventoryItem ou InventoryBalance.
- **Almoxarifado só por presença logística:** saldo de item elegível no
  almoxarifado ou item elegível com `defaultWarehouseId` nele. 1 → `READY`;
  mais de 1 → `NEEDS_WAREHOUSE_SELECTION`; nenhum → `CONFIGURATION_REQUIRED`.
  Sem o fallback de MP para todos os almoxarifados ACTIVE.
- **Prepare** (`prepareComponentSectorForCounting` /
  `prepareFinishedProductSectorForCounting`): só valida e diagnostica
  (`itemsTotal`, `itemsEligible`, `itemsWithoutProductId`,
  `itemsWithoutStockControl`); auditoria `COLLECTOR_SECTOR_PREPARED`.
- **População** (`populateComponentCountLines` /
  `populateFinishedProductCountLines`): 2 leituras + 1 `createMany`. Uma linha
  por saldo (item × endereço) com `systemQuantity = physicalQuantity`; item só
  com almoxarifado padrão entra com `0`, sem criar saldo; item com saldo **e**
  padrão não ganha linha extra. Item com saldo em mais de um endereço gera uma
  linha por endereço — o ajuste precisa cair no endereço certo
  (`itemsWithMultipleLocations` no diagnóstico). Itens da carga Nomus (saldo sem
  endereço) dão exatamente uma linha por item.
- **Zero linhas:** `COLLECTOR_NO_ELIGIBLE_ITEMS` / `COLLECTOR_NO_LINES` com
  mensagem do setor, e rollback — nunca sobra sessão vazia.
- **Auditoria:** `COLLECTOR_COUNT_SESSION_CREATED` / `_STARTED` /
  `_REUSED` (setor, almoxarifado, sessão, dispositivo, linhas, criada ou
  reutilizada), gravadas após o commit. Finalização e ajustes usam os eventos
  existentes (`FINALIZE`, `APPROVE`, `GENERATE_ADJUSTMENTS`,
  `COLLECTOR_APPLY_ADJUSTMENTS`, este agora com `sector` e `warehouseId`).

## Sessão COUNTING por setor

`InventoryCountSession` não tem coluna de setor. A compatibilidade de uma
COUNTING existente (`collectorSessionCompatibility.server.ts`) é provada pelas
**linhas**: o setor só continua sessão cujas linhas sejam todas do seu
`itemType`. O prefixo do código é sinal auxiliar:

| Sessão | Resultado |
|---|---|
| linhas todas do itemType do setor, prefixo do setor ou não-Collector (ex. `CF-`) | continua |
| alguma linha de outro itemType | 409 |
| linhas do itemType, mas prefixo de outro setor do Collector | 409 |
| vazia com prefixo do próprio setor | continua (e é populada) |
| vazia sem prefixo do setor | 409 (origem não provada → falha fechado) |

- MP mantém o fluxo atual: olha só a COUNTING mais recente do almoxarifado.
  Componentes e Produto acabado avaliam **todas** as COUNTING do almoxarifado.
- Sessão incompatível nunca é escondida para abrir outra: não existem duas
  COUNTING concorrentes no mesmo almoxarifado. Setores que dividem almoxarifado
  contam em sequência.
- Abrir/continuar sessão é serializado por almoxarifado com
  `pg_advisory_xact_lock` (dentro da transação; não trava linhas nem FKs).

## Relatórios

Posição de estoque e dashboard leem todos os saldos e já valorizam
`COMPONENT`/`FINISHED_PRODUCT` pelo produto: refletem o saldo ajustado sem
mudança. Relatórios de MP (suprimentos, diagnóstico de material, valor de MP,
retirada) continuam exclusivos de MP.

## Contagem cega

DTO de itens **não** inclui `systemQuantity` / `expectedQuantity` /
`adjustmentDelta` antes da contagem. Divergências só aparecem após finalize.

## Ajustes

Sempre via `createInventoryMovement` / `generateInventoryCountAdjustments`.
`CreateInventoryMovementContext.userId` é opcional; `deviceId` vai nas notes.
DEVICE não inventa `AppUser`.

## Suprimentos (tablet)

`searchMaterialStockTablet`: se a MP tem InventoryItem ACTIVE vinculado por
`materialId`, a quantidade exibida é a soma canônica de
`InventoryBalance.physicalQuantity` (mesma agregação da projeção).
`Material.quantity` fica só para legado não vinculado. Sem writes.
