/**
 * Tipos client-safe do where-used BOM (ProductBOM).
 * Sem Prisma runtime — ItemType é type-only.
 */
import type { ItemType } from "@prisma/client";

export type BomUsageSearchKind = "PRODUCT" | "MATERIAL";

export type BomUsageItemKind = "MATERIAL" | "PRODUCT" | "COMPONENT";

export type BomUsageMaterialItem = {
  id: string;
  code: string;
  description: string;
  unit: string;
};

export type BomUsageProductItem = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: ItemType;
};

export type BomUsageItem = BomUsageMaterialItem | BomUsageProductItem;

export type BomUsageLine = {
  bomLineId: string;
  parentProductId: string;
  parentSku: string;
  parentName: string;
  parentDescription: string | null;
  parentType: ItemType;
  parentStatus: string | null;
  quantity: number;
  lossPercentage: number | null;
  notes: string | null;
  sourceSystem: string | null;
  isNomusControlled: boolean;
  localException: boolean;
  nomusComponentCode: string | null;
  lastNomusSyncAt: string | null;
};

export type BomUsageResult = {
  searchedCode: string;
  itemKind: BomUsageItemKind;
  item: BomUsageItem;
  directUsageCount: number;
  usages: BomUsageLine[];
};

export type BomUsageAmbiguityCandidate = {
  kind: BomUsageSearchKind;
  id: string;
  code: string;
  label: string;
};

export type ResolveProductBomUsageInput = {
  code: string;
  kind?: BomUsageSearchKind | null;
};

export type ResolveProductBomUsageOutcome =
  | { status: "ok"; data: BomUsageResult }
  | { status: "not_found"; searchedCode: string; message: string }
  | {
      status: "ambiguous";
      searchedCode: string;
      message: string;
      candidates: BomUsageAmbiguityCandidate[];
    };
