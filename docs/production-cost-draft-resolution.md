# Resolução de DRAFTs equivalentes após publicação oficial

## Contexto

Snapshots de engenharia (`AUTO-{data}-{SKU}`) e revisões DRAFT da tabela de custo de produção podem coexistir com a versão **PUBLISHED** vigente. A UI de Engenharia de Produto só deve sinalizar pendência **crítica** quando há impacto financeiro real.

## Onde ficam os artefatos

| Artefato | Modelo Prisma | Status possíveis |
|----------|---------------|------------------|
| Versão de tabela | `ProductionCostTableVersion` | `DRAFT`, `PUBLISHED`, `SUPERSEDED`, `ARCHIVED` |
| Linha por SKU | `ProductionCostTableItem` | ligada à versão; inclui `unitProductionCost`, `calculationHash` |

## Regra pós-publicação

Após `publishProductionCostTableVersion` (unitária ou em lote via `publishProductionCostVersionFromDraft`):

1. Para cada SKU publicado, buscar DRAFTs **de outras versões** com o mesmo `productId`.
2. Se `|custoDRAFT − custoPublicado| ≤ 0,000001`:
   - **AUTO-\***: versão inteira → `ARCHIVED` (histórico preservado).
   - **Revisão mista**: remove apenas a linha do SKU; se a revisão ficar vazia ou 100% resolvida → `ARCHIVED`.
3. Se o custo difere → DRAFT permanece `DRAFT` (pendência real).
4. Versões `PUBLISHED` / `SUPERSEDED` **nunca** são alteradas retroativamente.

## UI e alertas

- Classificação: `resolveProductEngineeringCostWarning()` em `productEngineeringCostWarning.ts`.
- Diferença real de custo → `COST_DIFF_PENDING_PUBLICATION`.
- Mesmo custo, hash técnico diferente → `TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT` (aviso leve).
- Mesmo custo, sem DRAFT ativo → sem alerta crítico.

## Auditoria

DRAFTs arquivados recebem nota em `ProductionCostTableVersion.notes`:

`ARCHIVED — custo equivalente publicado na versão {id}`

Consulta histórica: versões `ARCHIVED` e `SUPERSEDED` permanecem no banco.

## Referência de código

- `archiveEquivalentProductionCostDrafts()` — `productionCostTables.server.ts`
- Tolerância numérica — `PRODUCT_ENGINEERING_COST_TOLERANCE` (1e-6)
