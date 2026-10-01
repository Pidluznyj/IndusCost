/**
 * Relatório de Estoque – Composição de Custo (exportação técnica para a contabilidade).
 *
 * Mesma população, mesmo saldo e mesma fonte de custo da "Posição de estoque"
 * (`inventoryPositionReport.ts`): saldo físico somado por item, só saldo > 0,
 * tipos MP / componente / produto acabado, custo PUBLICADO congelado.
 *
 * O que muda é a leitura do custo: para PA e componente o `PriceTableItem` da
 * Tabela Comercial Varejo 1 vigente guarda, além do custo fabril congelado
 * (`frozenTotalCost` = totalIndustrialCost do motor oficial), a decomposição
 * congelada no MESMO momento (`frozenMaterialCost` = MP, `frozenHhCost` = HH,
 * `frozenHmCost` = HM). Este módulo só DERIVA:
 *
 *   CIU oficial   = frozenTotalCost
 *   CIU sem HH    = CIU oficial − HH            (validação: = MP + HM)
 *   Valores       = quantidade × custo unitário
 *
 * Nada é recalculado: ciclo, cavidades, eficiência, setup, lote e perdas já
 * estão dentro de MP/HH/HM do snapshot. O motor vivo não é chamado. Ausência de
 * custo não vira zero. Decomposição que não fecha é marcada, não corrigida.
 */
import { Prisma } from "@prisma/client";
import type { InventoryPositionItemType, InventoryPositionReportSourceLine } from "./inventoryPositionReport.js";

export const INVENTORY_COST_COMPOSITION_REPORT_TITLE = "Relatório de Estoque – Composição de Custo";

export const INVENTORY_COST_COMPOSITION_REPORT_PURPOSE =
  "Exportação técnica e auditável da posição de estoque com o custo industrial oficial decomposto em matéria-prima (MP), homem-hora (HH) e hora-máquina (HM), e uma visão ajustada sem a parcela HH. O relatório não decide tratamento contábil: apenas destaca a mão de obra já incorporada ao custo industrial para que a contabilidade possa excluí-la, se for o caso.";

/** Diferença máxima aceita entre CIU e MP + HH + HM (valores gravados com 6 casas). */
export const INVENTORY_COST_COMPOSITION_TOLERANCE = new Prisma.Decimal("0.0001");

export const INVENTORY_COST_COMPOSITION_WAREHOUSE_LABEL = "Todos (consolidado)";

export type InventoryCostCompositionStatus =
  | "OK"
  | "SEM_CUSTO"
  | "CUSTO_PARCIAL"
  | "INCONSISTENTE"
  | "NAO_APLICAVEL";

export const INVENTORY_COST_COMPOSITION_INCONSISTENT_NOTE =
  "Decomposição MP + HH + HM não reconcilia com CIU oficial";

/** Decomposição congelada de um produto na versão publicada (mesmo snapshot temporal). */
export type InventoryFrozenCostComposition = {
  total: Prisma.Decimal;
  material: Prisma.Decimal;
  hh: Prisma.Decimal;
  hm: Prisma.Decimal;
  /** Lido do snapshot da publicação quando existe; null = não registrado. */
  costAnalysisPartial: boolean | null;
};

export type InventoryCostCompositionRow = {
  itemCode: string;
  description: string;
  itemType: InventoryPositionItemType;
  itemTypeLabel: string;
  warehouseLabel: string;
  unit: string;
  /** Saldo físico consolidado, sem arredondar. */
  physicalQuantity: string;
  materialUnitCost: number | null;
  hhUnitCost: number | null;
  hmUnitCost: number | null;
  officialUnitCost: number | null;
  unitCostWithoutHh: number | null;
  hhRemovedUnit: number | null;
  officialStockValue: number | null;
  hhStockValue: number | null;
  stockValueWithoutHh: number | null;
  status: InventoryCostCompositionStatus;
  observation: string;
};

export type InventoryCostCompositionSummaryRow = {
  itemType: InventoryPositionItemType | "TOTAL";
  label: string;
  skuCount: number;
  physicalQuantity: string;
  officialStockValue: number;
  hhStockValue: number;
  stockValueWithoutHh: number;
  /** HH incorporado / valor oficial, em fração (0–1). Null sem valor oficial. */
  hhSharePercent: number | null;
  itemsWithoutCost: number;
  itemsPartialCost: number;
  itemsInconsistent: number;
};

export type InventoryCostCompositionSource = {
  label: string;
  value: string;
};

export type InventoryCostCompositionReport = {
  title: string;
  purpose: string;
  generatedAt: string;
  rows: InventoryCostCompositionRow[];
  summary: InventoryCostCompositionSummaryRow[];
  methodology: string[];
  sources: InventoryCostCompositionSource[];
  negativeItems: number;
  excludedOtherPositiveItems: number;
  factoryCostUnavailableReason: string | null;
  materialCostUnavailableReason: string | null;
};

const SECTION_ORDER: InventoryPositionItemType[] = ["RAW_MATERIAL", "COMPONENT", "FINISHED_PRODUCT"];

const TYPE_LABEL: Record<InventoryPositionItemType, string> = {
  RAW_MATERIAL: "Matéria-prima",
  COMPONENT: "Componente",
  FINISHED_PRODUCT: "Produto acabado",
};

const SUMMARY_LABEL: Record<InventoryPositionItemType, string> = {
  RAW_MATERIAL: "Matéria-prima",
  COMPONENT: "Componentes",
  FINISHED_PRODUCT: "Produtos acabados",
};

const ZERO = new Prisma.Decimal(0);

function isPositionType(itemType: string): itemType is InventoryPositionItemType {
  return itemType === "RAW_MATERIAL" || itemType === "COMPONENT" || itemType === "FINISHED_PRODUCT";
}

type AggregatedLine = {
  itemType: string;
  code: string;
  description: string;
  unit: string;
  productId: string | null;
  materialId: string | null;
  physicalQuantity: Prisma.Decimal;
};

/** Idêntico à posição de estoque: soma o saldo físico do item em todos os almoxarifados. */
function aggregateLines(lines: readonly InventoryPositionReportSourceLine[]): AggregatedLine[] {
  const byItem = new Map<string, AggregatedLine>();
  for (const line of lines) {
    const current = byItem.get(line.itemId);
    if (!current) {
      byItem.set(line.itemId, {
        itemType: line.itemType,
        code: line.code,
        description: line.description,
        unit: line.unit,
        productId: line.productId,
        materialId: line.materialId,
        physicalQuantity: line.physicalQuantity,
      });
      continue;
    }
    current.physicalQuantity = current.physicalQuantity.add(line.physicalQuantity);
  }
  return [...byItem.values()];
}

function compareCode(a: { itemCode: string }, b: { itemCode: string }): number {
  return a.itemCode.localeCompare(b.itemCode, "pt-BR", { numeric: true, sensitivity: "base" });
}

function num(value: Prisma.Decimal | null): number | null {
  return value == null ? null : value.toNumber();
}

type Resolved = {
  material: Prisma.Decimal | null;
  hh: Prisma.Decimal | null;
  hm: Prisma.Decimal | null;
  official: Prisma.Decimal | null;
  withoutHh: Prisma.Decimal | null;
  status: InventoryCostCompositionStatus;
  observation: string;
};

function resolveRawMaterial(
  materialId: string | null,
  materialCostByMaterialId: ReadonlyMap<string, Prisma.Decimal | null> | null,
  unavailableReason: string | null
): Resolved {
  const none = (observation: string): Resolved => ({
    material: null,
    hh: null,
    hm: null,
    official: null,
    withoutHh: null,
    status: "SEM_CUSTO",
    observation,
  });
  if (!materialCostByMaterialId) return none(unavailableReason ?? "Tabela oficial de matéria-prima não publicada");
  if (!materialId) return none("Item sem vínculo com o cadastro oficial de matéria-prima");
  if (!materialCostByMaterialId.has(materialId)) return none("Material fora da tabela oficial de matéria-prima vigente");
  const cost = materialCostByMaterialId.get(materialId);
  if (cost == null) return none("Custo posto duplicado ou ausente na tabela oficial vigente");
  // MP pura: o custo é o próprio material. Não há engenharia, então HH = HM = 0 e CIU = MP.
  return {
    material: cost,
    hh: ZERO,
    hm: ZERO,
    official: cost,
    withoutHh: cost,
    status: "OK",
    observation: "Custo posto congelado; sem HH/HM",
  };
}

function resolveManufactured(
  productId: string | null,
  compositionByProductId: ReadonlyMap<string, InventoryFrozenCostComposition | null> | null,
  unavailableReason: string | null,
  tolerance: Prisma.Decimal
): Resolved {
  const none = (observation: string): Resolved => ({
    material: null,
    hh: null,
    hm: null,
    official: null,
    withoutHh: null,
    status: "SEM_CUSTO",
    observation,
  });
  if (!compositionByProductId) return none(unavailableReason ?? "Tabela Comercial Varejo 1 não publicada");
  if (!productId) return none("Item sem vínculo com o cadastro de produto");
  if (!compositionByProductId.has(productId)) return none("Produto fora da Tabela Comercial Varejo 1 vigente");
  const frozen = compositionByProductId.get(productId);
  if (frozen == null) return none("Custo congelado duplicado ou ausente na versão vigente");

  const official = frozen.total;
  const withoutHh = official.sub(frozen.hh);
  const sumParts = frozen.material.add(frozen.hh).add(frozen.hm);
  const reconciles =
    official.sub(sumParts).abs().lte(tolerance) &&
    withoutHh.sub(frozen.material.add(frozen.hm)).abs().lte(tolerance);

  if (!reconciles) {
    return {
      material: frozen.material,
      hh: frozen.hh,
      hm: frozen.hm,
      official,
      withoutHh,
      status: "INCONSISTENTE",
      observation: `${INVENTORY_COST_COMPOSITION_INCONSISTENT_NOTE} (diferença ${official.sub(sumParts).toFixed(6)})`,
    };
  }
  if (frozen.costAnalysisPartial === true) {
    return {
      material: frozen.material,
      hh: frozen.hh,
      hm: frozen.hm,
      official,
      withoutHh,
      status: "CUSTO_PARCIAL",
      observation: "Motor oficial marcou o custo como parcial na publicação (costAnalysisPartial)",
    };
  }
  return {
    material: frozen.material,
    hh: frozen.hh,
    hm: frozen.hm,
    official,
    withoutHh,
    status: "OK",
    observation: "",
  };
}

type SummaryDraft = {
  skuCount: number;
  quantity: Prisma.Decimal;
  official: Prisma.Decimal;
  hh: Prisma.Decimal;
  withoutHh: Prisma.Decimal;
  withoutCost: number;
  partial: number;
  inconsistent: number;
};

function emptySummary(): SummaryDraft {
  return {
    skuCount: 0,
    quantity: ZERO,
    official: ZERO,
    hh: ZERO,
    withoutHh: ZERO,
    withoutCost: 0,
    partial: 0,
    inconsistent: 0,
  };
}

function finishSummary(
  itemType: InventoryPositionItemType | "TOTAL",
  label: string,
  draft: SummaryDraft
): InventoryCostCompositionSummaryRow {
  return {
    itemType,
    label,
    skuCount: draft.skuCount,
    physicalQuantity: draft.quantity.toString(),
    officialStockValue: draft.official.toNumber(),
    hhStockValue: draft.hh.toNumber(),
    stockValueWithoutHh: draft.withoutHh.toNumber(),
    hhSharePercent: draft.official.gt(ZERO) ? draft.hh.div(draft.official).toNumber() : null,
    itemsWithoutCost: draft.withoutCost,
    itemsPartialCost: draft.partial,
    itemsInconsistent: draft.inconsistent,
  };
}

export type InventoryCostCompositionReportInput = {
  lines: readonly InventoryPositionReportSourceLine[];
  generatedAt: Date;
  /** Null = Varejo 1 sem versão publicada vigente. Valor null no mapa = duplicado/ausente (fail-closed). */
  compositionByProductId: ReadonlyMap<string, InventoryFrozenCostComposition | null> | null;
  /** Custo posto congelado da tabela oficial de MP. Null = tabela não publicada. */
  materialCostByMaterialId: ReadonlyMap<string, Prisma.Decimal | null> | null;
  factoryCostUnavailableReason?: string | null;
  materialCostUnavailableReason?: string | null;
  /** Origem/versão das tabelas e da aplicação, para a aba Metodologia. */
  sources?: readonly InventoryCostCompositionSource[];
  tolerance?: Prisma.Decimal;
};

export function buildInventoryCostCompositionReport(
  input: InventoryCostCompositionReportInput
): InventoryCostCompositionReport {
  const tolerance = input.tolerance ?? INVENTORY_COST_COMPOSITION_TOLERANCE;
  const aggregated = aggregateLines(input.lines);
  const rows: InventoryCostCompositionRow[] = [];
  const drafts = new Map<InventoryPositionItemType, SummaryDraft>();
  for (const type of SECTION_ORDER) drafts.set(type, emptySummary());
  const total = emptySummary();
  let negativeItems = 0;
  let excludedOtherPositiveItems = 0;

  for (const line of aggregated) {
    if (line.physicalQuantity.eq(ZERO)) continue;
    if (line.physicalQuantity.lt(ZERO)) {
      negativeItems += 1;
      continue;
    }
    if (!isPositionType(line.itemType)) {
      excludedOtherPositiveItems += 1;
      continue;
    }

    const resolved =
      line.itemType === "RAW_MATERIAL"
        ? resolveRawMaterial(line.materialId, input.materialCostByMaterialId, input.materialCostUnavailableReason ?? null)
        : resolveManufactured(
            line.productId,
            input.compositionByProductId,
            input.factoryCostUnavailableReason ?? null,
            tolerance
          );

    const quantity = line.physicalQuantity;
    const officialValue = resolved.official == null ? null : quantity.mul(resolved.official);
    const hhValue = resolved.hh == null ? null : quantity.mul(resolved.hh);
    const withoutHhValue = resolved.withoutHh == null ? null : quantity.mul(resolved.withoutHh);

    rows.push({
      itemCode: line.code,
      description: line.description,
      itemType: line.itemType,
      itemTypeLabel: TYPE_LABEL[line.itemType],
      warehouseLabel: INVENTORY_COST_COMPOSITION_WAREHOUSE_LABEL,
      unit: line.unit,
      physicalQuantity: quantity.toString(),
      materialUnitCost: num(resolved.material),
      hhUnitCost: num(resolved.hh),
      hmUnitCost: num(resolved.hm),
      officialUnitCost: num(resolved.official),
      unitCostWithoutHh: num(resolved.withoutHh),
      hhRemovedUnit: num(resolved.hh),
      officialStockValue: num(officialValue),
      hhStockValue: num(hhValue),
      stockValueWithoutHh: num(withoutHhValue),
      status: resolved.status,
      observation: resolved.observation,
    });

    for (const draft of [drafts.get(line.itemType)!, total]) {
      draft.skuCount += 1;
      draft.quantity = draft.quantity.add(quantity);
      if (officialValue) draft.official = draft.official.add(officialValue);
      if (hhValue) draft.hh = draft.hh.add(hhValue);
      if (withoutHhValue) draft.withoutHh = draft.withoutHh.add(withoutHhValue);
      if (resolved.status === "SEM_CUSTO") draft.withoutCost += 1;
      if (resolved.status === "CUSTO_PARCIAL") draft.partial += 1;
      if (resolved.status === "INCONSISTENTE") draft.inconsistent += 1;
    }
  }

  rows.sort((a, b) => {
    const order = SECTION_ORDER.indexOf(a.itemType) - SECTION_ORDER.indexOf(b.itemType);
    return order !== 0 ? order : compareCode(a, b);
  });

  const summary = [
    ...SECTION_ORDER.map((type) => finishSummary(type, SUMMARY_LABEL[type], drafts.get(type)!)),
    finishSummary("TOTAL", "TOTAL", total),
  ];

  return {
    title: INVENTORY_COST_COMPOSITION_REPORT_TITLE,
    purpose: INVENTORY_COST_COMPOSITION_REPORT_PURPOSE,
    generatedAt: input.generatedAt.toISOString(),
    rows,
    summary,
    methodology: [
      "Fonte de custo: IndusCost",
      "CIU oficial = MP + HH + HM",
      "CIU sem HH = CIU oficial - HH",
      "Ciclo, cavidades, eficiência, setup, lote e perdas permanecem considerados pelo motor oficial.",
      "O relatório não altera nem recalcula a engenharia do produto.",
      "Apenas destaca e exclui a parcela de mão de obra HH da visão ajustada.",
      "População e saldo: os mesmos da Posição de estoque — saldo físico atual somado por item em todos os almoxarifados (linha consolidada), somente saldo maior que zero, tipos matéria-prima, componente e produto acabado. Saldos negativos e outros tipos ficam fora.",
      "Produto acabado e componente: CIU oficial, MP, HH e HM são os valores congelados no mesmo item da Tabela Comercial Varejo 1 vigente (custo fabril congelado na formação de preço, originado da tabela oficial de custo de produção). Não há recálculo com parâmetros atuais.",
      "Matéria-prima: MP = custo posto congelado da tabela oficial de matéria-prima vigente; HH = HM = 0; CIU oficial = CIU sem HH = MP.",
      "Reconciliação por item: |CIU - (MP + HH + HM)| e |CIU sem HH - (MP + HM)| dentro de " +
        tolerance.toString() +
        ". Fora disso o item recebe status INCONSISTENTE e nenhum valor é corrigido.",
      "Status: OK; SEM_CUSTO (sem custo oficial publicado — colunas de custo vazias, nunca zero); CUSTO_PARCIAL (motor oficial marcou o custo como parcial); INCONSISTENTE (decomposição não fecha).",
      "CIF e OPEX não fazem parte do CIU oficial (MP + HH + HM) e não entram em nenhuma coluna deste relatório.",
      "Valores unitários e totais são gravados sem arredondamento; a formatação da planilha exibe 6 casas nos unitários e 2 casas nos totais.",
    ],
    sources: [...(input.sources ?? [])],
    negativeItems,
    excludedOtherPositiveItems,
    factoryCostUnavailableReason: input.factoryCostUnavailableReason ?? null,
    materialCostUnavailableReason: input.materialCostUnavailableReason ?? null,
  };
}
