export const QUANTITY_TOLERANCE = 0.000001;

export type NomusEffectiveBomLine = {
  externalLineId: number;
  parentCode: string;
  componentCode: string;
  componentDescription?: string | null;
  quantity: number | null;
  lossQuantity: number | null;
  listaMateriaisId?: number | null;
  listaMateriaisNome?: string | null;
  listaMateriaisPadrao?: boolean | null;
  listaMateriaisPadraoBlocoK?: boolean | null;
  listaMateriaisAtivo?: boolean | null;
  opcional?: boolean | null;
  alternativo?: boolean | null;
  preferencial?: boolean | null;
  posicao?: number | null;
};

export type IndusBomLine = {
  productSku: string;
  componentCode: string;
  componentKind: "PRODUCT" | "MATERIAL" | "UNKNOWN";
  componentDescription?: string | null;
  quantity: number | null;
  lossPercentage?: number | null;
  bomLineId: string;
};

export type BomComparisonStatus =
  | "MATCH"
  | "QUANTITY_DIFF"
  | "ONLY_IN_NOMUS"
  | "ONLY_IN_INDUSCOST"
  | "MISSING_PRODUCT_IN_INDUSCOST"
  | "NO_NOMUS_BOM"
  | "NO_INDUS_BOM"
  | "AMBIGUOUS_NOMUS_LIST";

export type NomusListSummary = {
  listaMateriaisId?: number | null;
  listaMateriaisNome?: string | null;
  listaMateriaisPadrao?: boolean | null;
  listaMateriaisPadraoBlocoK?: boolean | null;
  linesCount: number;
};

export type ChooseEffectiveNomusListResult = {
  selectedLines: NomusEffectiveBomLine[];
  selectedList: NomusListSummary | null;
  ignoredLists: NomusListSummary[];
  ambiguous: boolean;
};

export type BomComparisonResult = {
  parentCode: string;
  parentDescription?: string | null;
  indusProductId?: string | null;
  selectedNomusList?: NomusListSummary | null;
  ignoredNomusLists: NomusListSummary[];
  summary: {
    nomusLines: number;
    indusLines: number;
    matches: number;
    quantityDiffs: number;
    onlyInNomus: number;
    onlyInIndusCost: number;
    missingProductInIndusCost: boolean;
    ambiguousNomusList: boolean;
    status: "OK" | "DIVERGENT" | "BLOCKED";
  };
  lines: Array<{
    componentCode: string;
    componentDescription?: string | null;
    status: BomComparisonStatus;
    nomusQuantity?: number | null;
    indusQuantity?: number | null;
    quantityDiff?: number | null;
    quantityDiffAbs?: number | null;
    nomus?: NomusEffectiveBomLine | null;
    indus?: IndusBomLine | null;
  }>;
};

type NomusListGroup = {
  meta: NomusListSummary & { listaMateriaisAtivo: boolean | null };
  lines: NomusEffectiveBomLine[];
};

export function normalizeSku(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function normalizeComponentCode(value: string): string {
  return normalizeSku(value);
}

export function toNumberSafe(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = Number((value as { toNumber: () => number }).toNumber());
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function listGroupKey(line: NomusEffectiveBomLine): string {
  const id = line.listaMateriaisId ?? "null";
  const name = (line.listaMateriaisNome ?? "").trim().toUpperCase();
  return `${id}::${name}`;
}

function groupLinesByNomusList(lines: NomusEffectiveBomLine[]): NomusListGroup[] {
  const map = new Map<string, NomusListGroup>();
  for (const line of lines) {
    const key = listGroupKey(line);
    const existing = map.get(key);
    if (existing) {
      existing.lines.push(line);
      existing.meta.linesCount += 1;
      continue;
    }
    map.set(key, {
      meta: {
        listaMateriaisId: line.listaMateriaisId ?? null,
        listaMateriaisNome: line.listaMateriaisNome ?? null,
        listaMateriaisPadrao: line.listaMateriaisPadrao ?? null,
        listaMateriaisPadraoBlocoK: line.listaMateriaisPadraoBlocoK ?? null,
        listaMateriaisAtivo: line.listaMateriaisAtivo ?? null,
        linesCount: 1,
      },
      lines: [line],
    });
  }
  return [...map.values()];
}

function pickFromPool(pool: NomusListGroup[], allGroups: NomusListGroup[]): ChooseEffectiveNomusListResult {
  if (pool.length === 0) {
    return {
      selectedLines: [],
      selectedList: null,
      ignoredLists: allGroups.map((g) => ({
        listaMateriaisId: g.meta.listaMateriaisId,
        listaMateriaisNome: g.meta.listaMateriaisNome,
        listaMateriaisPadrao: g.meta.listaMateriaisPadrao,
        listaMateriaisPadraoBlocoK: g.meta.listaMateriaisPadraoBlocoK,
        linesCount: g.meta.linesCount,
      })),
      ambiguous: false,
    };
  }

  let candidates = pool;
  if (candidates.length > 1) {
    const active = candidates.filter((g) => g.meta.listaMateriaisAtivo === true);
    if (active.length > 0) candidates = active;
  }

  if (candidates.length > 1) {
    const maxLines = Math.max(...candidates.map((g) => g.meta.linesCount));
    candidates = candidates.filter((g) => g.meta.linesCount === maxLines);
  }

  candidates.sort((a, b) => {
    const idA = a.meta.listaMateriaisId ?? Number.MAX_SAFE_INTEGER;
    const idB = b.meta.listaMateriaisId ?? Number.MAX_SAFE_INTEGER;
    if (idA !== idB) return idA - idB;
    return (a.meta.listaMateriaisNome ?? "").localeCompare(b.meta.listaMateriaisNome ?? "", "pt-BR");
  });

  const selected = candidates[0];
  const ambiguous = candidates.length > 1;

  const selectedList: NomusListSummary = {
    listaMateriaisId: selected.meta.listaMateriaisId,
    listaMateriaisNome: selected.meta.listaMateriaisNome,
    listaMateriaisPadrao: selected.meta.listaMateriaisPadrao,
    listaMateriaisPadraoBlocoK: selected.meta.listaMateriaisPadraoBlocoK,
    linesCount: selected.meta.linesCount,
  };

  const ignoredLists = allGroups
    .filter((g) => listGroupKey(g.lines[0]) !== listGroupKey(selected.lines[0]))
    .map((g) => ({
      listaMateriaisId: g.meta.listaMateriaisId,
      listaMateriaisNome: g.meta.listaMateriaisNome,
      listaMateriaisPadrao: g.meta.listaMateriaisPadrao,
      listaMateriaisPadraoBlocoK: g.meta.listaMateriaisPadraoBlocoK,
      linesCount: g.meta.linesCount,
    }));

  return {
    selectedLines: selected.lines,
    selectedList,
    ignoredLists,
    ambiguous,
  };
}

export function chooseEffectiveNomusList(lines: NomusEffectiveBomLine[]): ChooseEffectiveNomusListResult {
  const groups = groupLinesByNomusList(lines);
  if (groups.length === 0) {
    return { selectedLines: [], selectedList: null, ignoredLists: [], ambiguous: false };
  }
  if (groups.length === 1) {
    const g = groups[0];
    return {
      selectedLines: g.lines,
      selectedList: {
        listaMateriaisId: g.meta.listaMateriaisId,
        listaMateriaisNome: g.meta.listaMateriaisNome,
        listaMateriaisPadrao: g.meta.listaMateriaisPadrao,
        listaMateriaisPadraoBlocoK: g.meta.listaMateriaisPadraoBlocoK,
        linesCount: g.meta.linesCount,
      },
      ignoredLists: [],
      ambiguous: false,
    };
  }

  const padrao = groups.filter((g) => g.meta.listaMateriaisPadrao === true);
  if (padrao.length > 0) return pickFromPool(padrao, groups);

  const principal = groups.filter(
    (g) => (g.meta.listaMateriaisNome ?? "").trim().toLowerCase() === "principal"
  );
  if (principal.length > 0) return pickFromPool(principal, groups);

  const blocoK = groups.filter((g) => g.meta.listaMateriaisPadraoBlocoK === true);
  if (blocoK.length > 0) return pickFromPool(blocoK, groups);

  return pickFromPool(groups, groups);
}

function quantitiesMatch(nomusQty: number | null, indusQty: number | null): boolean {
  if (nomusQty == null && indusQty == null) return true;
  if (nomusQty == null || indusQty == null) return false;
  return Math.abs(nomusQty - indusQty) <= QUANTITY_TOLERANCE;
}

export function compareBom(
  parentCode: string,
  nomusLines: NomusEffectiveBomLine[],
  indusLines: IndusBomLine[],
  options?: {
    parentDescription?: string | null;
    indusProductId?: string | null;
    listSelection?: ChooseEffectiveNomusListResult;
    missingProductInIndusCost?: boolean;
  }
): BomComparisonResult {
  const listSelection = options?.listSelection ?? chooseEffectiveNomusList(nomusLines);
  const effectiveNomus = listSelection.selectedLines;

  const nomusByCode = new Map<string, NomusEffectiveBomLine>();
  for (const line of effectiveNomus) {
    nomusByCode.set(normalizeComponentCode(line.componentCode), line);
  }

  const indusByCode = new Map<string, IndusBomLine>();
  for (const line of indusLines) {
    indusByCode.set(normalizeComponentCode(line.componentCode), line);
  }

  const allCodes = new Set([...nomusByCode.keys(), ...indusByCode.keys()]);
  const comparisonLines: BomComparisonResult["lines"] = [];

  let matches = 0;
  let quantityDiffs = 0;
  let onlyInNomus = 0;
  let onlyInIndusCost = 0;

  for (const codeKey of [...allCodes].sort()) {
    const nomus = nomusByCode.get(codeKey) ?? null;
    const indus = indusByCode.get(codeKey) ?? null;
    const displayCode = nomus?.componentCode ?? indus?.componentCode ?? codeKey;
    const nomusQuantity = nomus?.quantity ?? null;
    const indusQuantity = indus?.quantity ?? null;

    let status: BomComparisonStatus;
    if (nomus && indus) {
      if (quantitiesMatch(nomusQuantity, indusQuantity)) {
        status = "MATCH";
        matches += 1;
      } else {
        status = "QUANTITY_DIFF";
        quantityDiffs += 1;
      }
    } else if (nomus) {
      status = "ONLY_IN_NOMUS";
      onlyInNomus += 1;
    } else {
      status = "ONLY_IN_INDUSCOST";
      onlyInIndusCost += 1;
    }

    const quantityDiff =
      nomusQuantity != null && indusQuantity != null ? indusQuantity - nomusQuantity : null;

    comparisonLines.push({
      componentCode: displayCode,
      componentDescription: nomus?.componentDescription ?? indus?.componentDescription ?? null,
      status,
      nomusQuantity,
      indusQuantity,
      quantityDiff,
      quantityDiffAbs: quantityDiff != null ? Math.abs(quantityDiff) : null,
      nomus,
      indus,
    });
  }

  comparisonLines.sort((a, b) => {
    const posA = a.nomus?.posicao ?? Number.MAX_SAFE_INTEGER;
    const posB = b.nomus?.posicao ?? Number.MAX_SAFE_INTEGER;
    if (posA !== posB) return posA - posB;
    return a.componentCode.localeCompare(b.componentCode, "pt-BR");
  });

  const missingProduct = options?.missingProductInIndusCost === true;
  const ambiguousNomusList = listSelection.ambiguous;
  const noNomus = effectiveNomus.length === 0;
  const noIndus = indusLines.length === 0;

  let summaryStatus: "OK" | "DIVERGENT" | "BLOCKED" = "OK";
  if (ambiguousNomusList) summaryStatus = "BLOCKED";
  else if (missingProduct || noNomus || noIndus || quantityDiffs > 0 || onlyInNomus > 0 || onlyInIndusCost > 0) {
    summaryStatus = "DIVERGENT";
  }

  return {
    parentCode,
    parentDescription: options?.parentDescription ?? null,
    indusProductId: options?.indusProductId ?? null,
    selectedNomusList: listSelection.selectedList,
    ignoredNomusLists: listSelection.ignoredLists,
    summary: {
      nomusLines: effectiveNomus.length,
      indusLines: indusLines.length,
      matches,
      quantityDiffs,
      onlyInNomus,
      onlyInIndusCost,
      missingProductInIndusCost: missingProduct,
      ambiguousNomusList,
      status: summaryStatus,
    },
    lines: comparisonLines,
  };
}
