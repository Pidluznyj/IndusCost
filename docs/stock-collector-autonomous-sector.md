# Stock Collector — fluxo autônomo por setor

## Objetivo

Permitir que um tablet no tailnet inicie e conclua a contagem física de
**Matéria-prima** sem login humano falso: identidade = `DEVICE` + `deviceId`
do Device Registry (Tailscale StableID).

## QR GERAL DE SETOR (deep-link)

O QR operacional da fase autônoma **não** é um QR por produto: é o deep-link do
setor, e nada mais.

| | |
|---|---|
| Setor | `RAW_MATERIAL` → slug `raw-material` |
| Path | `/collector/sector/raw-material` |
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
| POST | `/api/inventory/collector/count-sessions` | create+start idempotente (`MP-YYYYMMDD-NNN`) |
| GET | `/api/inventory/collector/count-sessions/:id/items` | lista **cega** (sem systemQuantity) |
| POST | `/api/inventory/collector/count` | wrapper DEVICE → `recordInventoryCount` |
| POST | `/api/inventory/collector/count-sessions/:id/finalize` | `allowUncounted`; auto-justificativa DEVICE; auto-approve |
| POST | `/api/inventory/collector/count-sessions/:id/apply-adjustments` | `confirm` + `operationId`; idempotente |

Rotas legadas (resolve-qr / PATCH lines / list COUNTING) são preservadas.

## População RAW_MATERIAL

Batch (sem N+1):

1. Materials ACTIVE (diagnóstico)
2. InventoryItems ACTIVE com `materialId` + `RAW_MATERIAL` (saldos do warehouse + defaultWarehouse)
3. InventoryBalances do warehouse
4. Linhas com `systemQuantity` do físico; item sem saldo → linha com `0`

Idempotente se a sessão já tiver linhas. Não cria motor paralelo nem atualiza
`InventoryBalance` / `Material.quantity` diretamente.

## Contagem cega

DTO de itens **não** inclui `systemQuantity` / `expectedQuantity` /
`adjustmentDelta` antes da contagem. Divergências só aparecem após finalize.

## Ajustes

Sempre via `createInventoryMovement` / `generateInventoryCountAdjustments`.
`CreateInventoryMovementContext.userId` é opcional; `deviceId` vai nas notes.
DEVICE não inventa `AppUser`.

## Suprimentos (tablet)

`searchMaterialStockTablet`: se a MP tem InventoryItem vinculado, a quantidade
exibida é a soma de `InventoryBalance.physicalQuantity`. `Material.quantity`
fica só para legado não vinculado. Sem writes.
