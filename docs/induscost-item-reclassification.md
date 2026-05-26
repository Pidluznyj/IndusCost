# IndusCost — Reclassificação de item (Produto / Componente / Material)

> Fase: `INDUSCOST-ITEM-RECLASSIFICATION-WORKFLOW-A`.
>
> Substitui o erro genérico `"Erro ao atualizar produto."` por um
> fluxo explícito com análise de impacto, confirmação textual e
> auditoria.

## 1. Glossário

No IndusCost, três conceitos operacionais convivem em **duas tabelas**:

| Conceito       | Onde mora             | Identificador          |
| -------------- | --------------------- | ---------------------- |
| **Produto**    | `Product.type=PRODUCT`     | `Product.sku`          |
| **Componente** | `Product.type=COMPONENT`   | `Product.sku`          |
| **Material**   | `Material` (tabela própria) | `Material.code`         |

- O enum Prisma `ItemType` tem **apenas** `PRODUCT` e `COMPONENT`.
- `MATERIAL` é uma classificação operacional: existe a tabela
  `Material`, separada de `Product`.
- `ProductBOM` aceita um filho por linha — ou `materialId`
  (Material) ou `childProductId` (Product). Nunca os dois.

## 2. Reclassificações suportadas

| Origem            | Destino               | Estratégia                                                                                       | Status nesta fase                                  |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Produto           | Componente            | `UPDATE Product.type = COMPONENT` (mesmo registro)                                              | ✔ Implementado                                     |
| Componente        | Produto               | `UPDATE Product.type = PRODUCT` + apaga Processo Padrão                                         | ✔ Implementado                                     |
| Produto/Componente | Material             | Cria `Material` novo com `code=sku` + `INACTIVE` no Product original (preserva histórico)         | ✔ Implementado, só em itens órfãos                |
| Material          | Produto/Componente   | Crie manualmente o Product e inative o Material no módulo de Suprimentos                          | ⚠ Não implementado nesta fase — apenas orientação |

Nenhuma reclassificação **deleta** registros. Tudo é update / criação
+ inativação.

## 3. Análise de impacto

Sempre que o usuário tenta mudar o tipo no modal **Editar Engenharia**,
o frontend abre **Reclassificar item** que carrega:

```
GET /api/products/:id/reclassification-impact?targetKind=...
```

A resposta inclui:

- **Cards** com contagens reais:
  - Estrutura própria (BOM como pai)
  - Usado como componente em BOMs alheias (BOM como filho)
  - Roteiro/processo cadastrado
  - Premissas comerciais (ProductPricing)
  - Propostas comerciais
  - Pedidos de venda
  - Linhas em tabela de preço (PriceTableItem)
  - Registros de cálculo de custo
  - Histórico/auditoria
  - Controlado pelo Nomus (Sim/Não)
- **Seções**: O que será mantido / alterado / preservado / bloqueado /
  pode ser perdido / recomendação.
- **Warnings** (não bloqueantes): item Nomus-controlled,
  perda de Processo Padrão (Componente → Produto), histórico comercial
  presente.
- **blockingReasons** (status `BLOCKED`): impede a operação.

A lógica pura está em `src/lib/itemReclassification.ts` e é coberta
por `src/lib/itemReclassification.test.ts` (25 testes).

## 4. Bloqueios e permissões

### 4.1 Produto ↔ Componente

Permitido por padrão. Exige confirmação textual quando:

- Item é controlado pelo Nomus.
- Item já tem propostas/pedidos/PriceTableItem.
- Componente → Produto e há Processo Padrão preenchido (será apagado).
- Item é usado como filho em BOMs alheias (apenas alerta).

Confirmação textual: `RECLASSIFICAR ITEM`.

### 4.2 Produto/Componente → Material

**Bloqueado** sempre que houver qualquer uma das condições abaixo:

| Bloqueio                       | Motivo                                                                |
| ------------------------------ | --------------------------------------------------------------------- |
| `BOM_AS_PARENT_PRESENT`        | Material não pode ter BOM. Remova a estrutura antes.                  |
| `ROUTING_PRESENT`              | Material não tem roteiro. Remova o roteiro antes.                     |
| `PROPOSAL_HISTORY_PRESENT`     | Já em propostas. Preserve histórico criando Material manual.          |
| `SALES_ORDER_HISTORY_PRESENT`  | Já em pedidos. Preserve histórico criando Material manual.            |
| `PRICE_TABLE_HISTORY_PRESENT`  | Tem linha em tabela de preço publicada. Despublique antes.            |
| `PRICING_PRESENT`              | Tem premissas comerciais. Limpe ProductPricing antes.                 |
| `USED_AS_CHILD_IN_BOM`         | É filho em BOMs alheias. Reaponte manualmente para `materialId` antes. |

Quando **nenhum** desses bloqueios se aplica, o fluxo é
`REQUIRES_CONFIRMATION` com texto exigido:

```
RECLASSIFICAR PARA MATERIAL <SKU>
```

Confirmação adicional (`ENTENDO QUE A ESTRUTURA PODE SER DESVINCULADA`)
é definida no contrato e usada apenas quando ainda existe alguma
linha de BOM relacionada após validação — nesta fase, isso já está
coberto pelo bloqueio `USED_AS_CHILD_IN_BOM`, então a confirmação
extra raramente aparece. Mantemos o contrato para fases futuras.

### 4.3 Material → Produto/Componente

**Bloqueado** nesta fase (`TARGET_KIND_NOT_IMPLEMENTED`). Recomenda
ao usuário:

1. Criar um novo Produto/Componente em **Engenharia** com o mesmo
   código.
2. Inativar o Material no módulo **Suprimentos** (`PATCH
   /api/materials/:id/status` → `INACTIVE`).
3. Se houver linhas de `ProductBOM.materialId`, reapontar manualmente
   para `childProductId` na tela de BOM.

A análise de impacto (`GET /api/materials/:id/reclassification-impact`)
funciona em modo leitura para orientar o usuário.

## 5. Impactos por dimensão

### 5.1 BOM (`ProductBOM`)

- **Produto ↔ Componente**: nada muda na BOM. Linhas e referências
  permanecem.
- **Produto/Componente → Material**: bloqueia se este item é pai de
  BOM (`bomLinesAsParent > 0`) ou usado como filho em BOMs alheias
  (`bomLinesAsChild > 0`).
- **Material → Produto/Componente**: linhas com `materialId` apontando
  para o Material não são alteradas pelo fluxo automático.

### 5.2 Roteiro (`ProductRouting`)

- **Produto ↔ Componente**: preservado.
- **Produto/Componente → Material**: bloqueia se há etapas
  (`routingSteps > 0`).

### 5.3 Custo

- A reclassificação NÃO altera o motor de custo. Recalcule a aba
  Análise de Custo após reclassificar — o `costSummary` do modal
  recarrega automaticamente quando o tipo muda.

### 5.4 Preço / Propostas / Pedidos

- **Nenhum** registro de `ProductPricing`, `ProposalItem`,
  `SalesOrderItem` ou `PriceTableItem` é apagado.
- Produto/Componente → Material é **bloqueado** sempre que houver
  qualquer dessas referências.
- Produto ↔ Componente apenas avisa: o item já foi usado
  comercialmente; confirme se a regra ainda faz sentido.

### 5.5 Nomus (item controlado)

- Item com `isNomusControlled=true` sempre dispara o warning
  `NOMUS_CONTROLLED`.
- A reclassificação manual fica gravada no `EngineeringChangeLog`,
  mas próximas sincronizações Nomus podem reverter campos
  controlados (sku/name/etc.). A decisão fica registrada no
  `EngineeringChangeLog.reason` (`ITEM_RECLASSIFICATION:`).

## 6. Auditoria / histórico

Toda reclassificação aplicada com sucesso registra entries em
`EngineeringChangeLog`:

- `changeOrigin = MANUAL_EDIT`
- `reason = "ITEM_RECLASSIFICATION: <descrição do plano>"`
- `oldValue` / `newValue` / `oldValueJson` / `newValueJson` com o
  snapshot mínimo.
- `changedBy = AppAuthContext.id` (ou e-mail).
- Quando converte Produto → Material, são criadas **duas** entries:
  - `PRODUCT @reclassified_to_material`
  - `MATERIAL @created_from_product`

Consulta SQL pronta:

```sql
select "changedAt", "productSku", "entityType",
       "fieldName", "oldValue", "newValue", reason, "changedBy"
  from "EngineeringChangeLog"
 where reason like 'ITEM_RECLASSIFICATION:%'
 order by "changedAt" desc
 limit 100;
```

Na UI, a aba **Histórico** do produto exibe normalmente essas
entries (já que `entityType IN (PRODUCT, MATERIAL)` é lido pelo
endpoint de histórico).

## 7. Endpoints

| Método | Rota                                              | Auth                                  | Função                       |
| ------ | ------------------------------------------------- | ------------------------------------- | ---------------------------- |
| GET    | `/api/products/:id/reclassification-impact`      | `products.edit`                       | Análise read-only            |
| POST   | `/api/products/:id/reclassify`                   | `products.edit`                       | Aplica reclassificação       |
| GET    | `/api/materials/:id/reclassification-impact`     | `products.edit` OU `materials.edit`  | Análise read-only (Material) |

Query params:

- `targetKind=PRODUCT|COMPONENT|MATERIAL` (obrigatório).

Body do POST `/reclassify`:

```jsonc
{
  "targetKind": "MATERIAL",          // ou PRODUCT/COMPONENT
  "confirmationText": "RECLASSIFICAR PARA MATERIAL 150.01-A",
  "extraConfirmationText": null,     // opcional, quando exigido
  "mode": "SAFE"                     // SAFE | FORCE_WITH_CONFIRMATION (atualmente só SAFE)
}
```

Respostas:

- `200 OK` com `{ ok: true, appliedPlan, productId, materialId, identifier, changeLogId, message }`.
- `400` com `{ error, code, message }` para inputs/confirmação inválidos.
- `409` com `{ error: "RECLASSIFICATION_BLOCKED", blockingReasons: [...] }` quando há bloqueio.
- `404` quando o item não existe.

## 8. PUT `/api/products/:id` — fim do erro genérico

Antes desta fase, qualquer payload com `type=MATERIAL` fazia o
endpoint cair no catch genérico e retornar:

```
500 { error: "Erro ao atualizar produto." }
```

Agora o endpoint:

1. Rejeita `type=MATERIAL` com **409** `PRODUCT_TYPE_RECLASSIFICATION_REQUIRED` e
   mensagem clara dizendo "use o fluxo de reclassificação".
2. Rejeita `type` inválido (`!== PRODUCT/COMPONENT/MATERIAL`) com **400**
   `INVALID_PRODUCT_TYPE`.
3. Rejeita troca de tipo (PRODUCT↔COMPONENT) com **409**
   `PRODUCT_TYPE_RECLASSIFICATION_REQUIRED` — força o fluxo de impacto.
4. Erros conhecidos do Prisma viram **409** (`P2002`) ou **404**
   (`P2025`) com mensagem explicativa.
5. Erros inesperados retornam **500** `PRODUCT_UPDATE_FAILED` **com a
   mensagem real do erro anexada** — não mais a string cega.

## 9. Frontend: fluxo no modal Editar Engenharia

`src/components/ProductModule.tsx`:

- Botões Produto / Componente / Material continuam visíveis.
- Em **criação** (sem `editingItem.id`), trocar tipo continua livre
  (não há registro no banco para reclassificar).
- Em **edição**, qualquer clique num tipo diferente do atual abre
  `<ItemReclassificationModal>` em vez de mutar `formData.type`.
  - O modal carrega a análise via GET.
  - Exibe cards + seções + confirmação textual.
  - Aplica via POST.
  - Em sucesso:
    - `UPDATE_PRODUCT_TYPE`: atualiza `editingItem.type` e
      `formData.type` localmente, chama `fetchData()` e recarrega
      custo.
    - `CONVERT_PRODUCT_TO_MATERIAL`: fecha o modal de engenharia,
      limpa estado de custo e recarrega lista.

`src/components/product/ItemReclassificationModal.tsx` é
auto-contido. Não pode ser usado fora do contexto de
`Product.id`/`Material.id` (precisa de um `sourceId`).

## 10. Testes

- `npm run test:products:item-reclassification`
  - 25 testes na lib pura (`src/lib/itemReclassification.test.ts`).
  - Casos: PRODUCT→COMPONENT, COMPONENT→PRODUCT (com/sem processo),
    bloqueios Produto→Material, MATERIAL→PRODUCT, NOOP, confirmação
    incorreta, NOMUS_CONTROLLED, etc.
- `npm test` engloba esses testes.
- `npm run check:frontend-imports`, `npm run lint`, `npm run build`
  permanecem verdes.

## 11. O que NÃO faz

- Não apaga `Product`, `Material`, `ProductBOM`, `ProductRouting`.
- Não altera preço, proposta, pedido.
- Não roda migration (usa enums existentes + status string).
- Não acessa Carga Mestre Nomus / Apply BOM / Igualar Bases.
- Não converte Material em Produto/Componente automaticamente
  (rota manual orientada).
- Não usa `setTimeout` ou gambiarras.

## 12. Próximas fases sugeridas

- `INDUSCOST-MATERIAL-TO-PRODUCT-MIGRATION-A`: implementar caminho
  Material → Produto/Componente com reapontamento opcional de
  `ProductBOM.materialId` para `childProductId`.
- `INDUSCOST-RECLASSIFICATION-NOMUS-DECISION-A`: integrar com o
  `NomusBomReviewDecision` para registrar divergência local quando o
  Nomus classifica diferente.
