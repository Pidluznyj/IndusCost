/**
 * Posição de estoque para contabilidade.
 * Quantidade = saldo físico somado por item.
 * Valor contábil de PA e componente = saldo × custo fabril congelado no Varejo 1.
 * Valor contábil de MP = saldo × custo posto congelado da tabela oficial de matéria-prima.
 * Valor de venda de PA e componente = saldo × preço Varejo 1. Não entra no valor contábil.
 */
import { Prisma } from "@prisma/client";

export const INVENTORY_POSITION_REPORT_TITLE = "Posição de estoque";

export const INVENTORY_POSITION_REPORT_PURPOSE =
  "Relatório de posição de estoque para apoio contábil, inclusive escrituração do Bloco K e valorização do estoque. A quantidade é o saldo físico. O valor contábil é a quantidade multiplicada pelo custo oficial congelado na formação de preço. O valor potencial de venda, quando existe, usa a Tabela Comercial Varejo 1 e não substitui o valor contábil.";

export type InventoryPositionItemType = "RAW_MATERIAL" | "COMPONENT" | "FINISHED_PRODUCT";

export type InventoryPositionReportSourceLine = {
  itemId: string;
  itemType: string;
  code: string;
  description: string;
  unit: string;
  productId: string | null;
  materialId: string | null;
  physicalQuantity: Prisma.Decimal;
};

export type InventoryPositionReportRow = {
  itemCode: string;
  description: string;
  unit: string;
  physicalQuantity: string;
  unitCost: number | null;
  totalCost: number | null;
  unitSalePrice: number | null;
  totalSaleValue: number | null;
};

export type InventoryPositionReportSection = {
  itemType: InventoryPositionItemType;
  title: string;
  costBasisLabel: string;
  rows: InventoryPositionReportRow[];
  itemCount: number;
  costCoveredItems: number;
  costUncoveredItems: number;
  costTotal: number | null;
  saleCoveredItems: number;
  saleUncoveredItems: number;
  saleTotal: number | null;
};

export type InventoryPositionReportFilter = {
  label: string;
  value: string;
};

export type InventoryPositionNegativeLine = {
  itemCode: string;
  description: string;
  unit: string;
  itemTypeLabel: string;
  physicalQuantity: string;
};

export type InventoryPositionReport = {
  title: string;
  purpose: string;
  generatedAt: string;
  filters: InventoryPositionReportFilter[];
  methodology: string[];
  sections: InventoryPositionReportSection[];
  negativeLines: InventoryPositionNegativeLine[];
  excludedOtherPositiveItems: number;
  retailUnavailableReason: string | null;
  factoryCostUnavailableReason: string | null;
  materialCostUnavailableReason: string | null;
};

const SECTION_ORDER: InventoryPositionItemType[] = ["RAW_MATERIAL", "COMPONENT", "FINISHED_PRODUCT"];

const SECTION_TITLE: Record<InventoryPositionItemType, string> = {
  RAW_MATERIAL: "Matérias-primas",
  COMPONENT: "Componentes",
  FINISHED_PRODUCT: "Produtos acabados",
};

const TYPE_LABEL: Record<InventoryPositionItemType, string> = {
  RAW_MATERIAL: "Matéria-prima",
  COMPONENT: "Componente",
  FINISHED_PRODUCT: "Produto acabado",
};

const ZERO = new Prisma.Decimal(0);

function moneyNumber(value: Prisma.Decimal): number {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

function lookupUnit(
  map: ReadonlyMap<string, Prisma.Decimal | null> | null,
  id: string | null
): Prisma.Decimal | null {
  if (!map || !id || !map.has(id)) return null;
  const unit = map.get(id);
  return unit == null ? null : unit;
}

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

export function buildInventoryPositionReport(input: {
  lines: readonly InventoryPositionReportSourceLine[];
  generatedAt: Date;
  retailPriceByProductId: ReadonlyMap<string, Prisma.Decimal | null> | null;
  factoryCostByProductId: ReadonlyMap<string, Prisma.Decimal | null> | null;
  materialCostByMaterialId: ReadonlyMap<string, Prisma.Decimal | null> | null;
  retailUnavailableReason?: string | null;
  factoryCostUnavailableReason?: string | null;
  materialCostUnavailableReason?: string | null;
}): InventoryPositionReport {
  const aggregated = aggregateLines(input.lines);
  const buckets = new Map<InventoryPositionItemType, AggregatedLine[]>();
  for (const type of SECTION_ORDER) buckets.set(type, []);
  const negativeLines: InventoryPositionNegativeLine[] = [];
  let excludedOtherPositiveItems = 0;

  for (const line of aggregated) {
    if (line.physicalQuantity.eq(ZERO)) continue;
    if (line.physicalQuantity.lt(ZERO)) {
      negativeLines.push({
        itemCode: line.code,
        description: line.description,
        unit: line.unit,
        itemTypeLabel: isPositionType(line.itemType) ? TYPE_LABEL[line.itemType] : line.itemType,
        physicalQuantity: line.physicalQuantity.toString(),
      });
      continue;
    }
    if (!isPositionType(line.itemType)) {
      excludedOtherPositiveItems += 1;
      continue;
    }
    buckets.get(line.itemType)?.push(line);
  }

  negativeLines.sort(compareCode);

  const retailAvailable = input.retailPriceByProductId != null;
  const factoryAvailable = input.factoryCostByProductId != null;
  const materialAvailable = input.materialCostByMaterialId != null;

  const sections = SECTION_ORDER.map((itemType) => {
    const source = buckets.get(itemType) ?? [];
    const usesSale = itemType !== "RAW_MATERIAL";
    const costMap = itemType === "RAW_MATERIAL" ? input.materialCostByMaterialId : input.factoryCostByProductId;
    const costAvailable = itemType === "RAW_MATERIAL" ? materialAvailable : factoryAvailable;
    let costTotal = ZERO;
    let saleTotal = ZERO;
    let costCoveredItems = 0;
    let costUncoveredItems = 0;
    let saleCoveredItems = 0;
    let saleUncoveredItems = 0;

    const rows = source
      .map((line) => {
        const costId = itemType === "RAW_MATERIAL" ? line.materialId : line.productId;
        const unitCost = lookupUnit(costMap, costId);
        const unitSale = usesSale ? lookupUnit(input.retailPriceByProductId, line.productId) : null;
        if (!costAvailable || unitCost == null) costUncoveredItems += 1;
        else costCoveredItems += 1;
        if (usesSale) {
          if (!retailAvailable || unitSale == null) saleUncoveredItems += 1;
          else saleCoveredItems += 1;
        }
        const totalCost = unitCost == null ? null : moneyNumber(line.physicalQuantity.mul(unitCost));
        const totalSale = !usesSale || unitSale == null ? null : moneyNumber(line.physicalQuantity.mul(unitSale));
        if (totalCost != null) costTotal = costTotal.add(totalCost);
        if (totalSale != null) saleTotal = saleTotal.add(totalSale);
        return {
          itemCode: line.code,
          description: line.description,
          unit: line.unit,
          physicalQuantity: line.physicalQuantity.toString(),
          unitCost: unitCost == null ? null : moneyNumber(unitCost),
          totalCost,
          unitSalePrice: !usesSale || unitSale == null ? null : moneyNumber(unitSale),
          totalSaleValue: totalSale,
        };
      })
      .sort(compareCode);

    return {
      itemType,
      title: SECTION_TITLE[itemType],
      costBasisLabel:
        itemType === "RAW_MATERIAL"
          ? "Custo posto congelado da tabela oficial de matéria-prima"
          : "Custo fabril congelado na Tabela Comercial Varejo 1",
      rows,
      itemCount: rows.length,
      costCoveredItems,
      costUncoveredItems,
      costTotal: costAvailable ? moneyNumber(costTotal) : null,
      saleCoveredItems,
      saleUncoveredItems,
      saleTotal: usesSale && retailAvailable ? moneyNumber(saleTotal) : null,
    };
  });

  return {
    title: INVENTORY_POSITION_REPORT_TITLE,
    purpose: INVENTORY_POSITION_REPORT_PURPOSE,
    generatedAt: input.generatedAt.toISOString(),
    filters: [
      { label: "Posição", value: "Saldo físico atual. Este relatório não reconstrói estoque de uma data passada." },
      { label: "Itens", value: "Somente saldo físico maior que zero, agrupado por item." },
      { label: "Almoxarifados", value: "Todos. Saldos do mesmo item em almoxarifados diferentes são somados." },
      { label: "Tipos", value: "Matéria-prima, componente e produto acabado." },
      {
        label: "Valor contábil",
        value:
          "Matéria-prima: quantidade × custo posto congelado. Produto acabado e componente: quantidade × custo fabril congelado no Varejo 1.",
      },
      {
        label: "Valor de venda",
        value: "Produto acabado e componente: quantidade × preço publicado da Tabela Comercial Varejo 1.",
      },
      { label: "Saldo negativo", value: "Listado à parte e fora dos totais valorizados." },
    ],
    methodology: [
      "A quantidade não usa o campo de quantidade do cadastro de matéria-prima. A fonte é o saldo físico do estoque.",
      "Item sem custo oficial publicado permanece na quantidade e fica sem valor. Ausência de custo não vira zero.",
      "Custo zero publicado é valor oficial e soma zero.",
      "Preço ou custo duplicado para o mesmo cadastro não escolhe uma das linhas: o item fica sem aquele valor.",
      sections.find((section) => section.itemType === "RAW_MATERIAL")?.costBasisLabel ?? "",
      "Produto acabado e componente usam o custo fabril já congelado na formação de preço, com matéria-prima, homem-hora e hora-máquina.",
    ].filter((line) => line.length > 0),
    sections,
    negativeLines,
    excludedOtherPositiveItems,
    retailUnavailableReason: input.retailUnavailableReason ?? null,
    factoryCostUnavailableReason: input.factoryCostUnavailableReason ?? null,
    materialCostUnavailableReason: input.materialCostUnavailableReason ?? null,
  };
}
