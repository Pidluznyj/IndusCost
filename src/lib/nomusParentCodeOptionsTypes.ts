export type NomusParentCodeOption = {
  parentCode: string;
  parentDescription: string | null;
  indusProductId: string | null;
  nomusLinesCount: number;
  selectedListName: string | null;
};

export type NomusParentCodeOptionsResponse = {
  search: string;
  rows: NomusParentCodeOption[];
};

export type ResolveNomusParentCodeResult =
  | { kind: "empty" }
  | { kind: "none"; search: string }
  | { kind: "single"; search: string; parentCode: string; option: NomusParentCodeOption }
  | { kind: "multiple"; search: string; options: NomusParentCodeOption[] };

export const NOMUS_PARENT_CODE_NOT_FOUND_MSG =
  "Nenhum produto encontrado para a busca informada. Tente o SKU completo.";
