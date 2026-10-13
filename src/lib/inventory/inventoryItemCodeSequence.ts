/**
 * Próximo código interno de item por tipo e família — puro (sem Prisma).
 *
 * Com família, o código segue `TIPO-FAM-NNNN` (ex.: `ADM-INF-0001`): a sequência é
 * própria de cada família dentro do tipo. Sem família, segue `TIPO-NNNN`.
 * As séries são lidas dos códigos já cadastrados: cada código é quebrado em
 * "prefixo + número final" (ex.: `ADM-0042` → `ADM-` + 42) e o próximo código é o
 * maior número + 1, preservando o preenchimento com zeros do último código.
 */
import type { InventoryItemType } from "./inventoryTypes.js";

/** Acima disso o final numérico é tratado como identificador (EAN etc.), não como sequência. */
const MAX_SEQUENCE_DIGITS = 9;

export type InventoryItemCodeSequence = {
  /** Prefixo como aparece no último código da série (ex.: `ADM-`). */
  prefix: string;
  lastCode: string;
  lastNumber: number;
  /** Quantidade de dígitos do último código (zeros à esquerda preservados). */
  width: number;
  /** Itens do tipo que seguem esta série. */
  seriesCount: number;
};

export type InventoryItemCodeSuggestion = InventoryItemCodeSequence & {
  code: string;
};

type ParsedCode = { prefix: string; number: number; width: number; code: string };

function parseSequentialCode(raw: string): ParsedCode | null {
  const code = String(raw ?? "").trim();
  const match = /^(.*?)(\d+)$/.exec(code);
  if (!match) return null;
  const digits = match[2];
  if (digits.length > MAX_SEQUENCE_DIGITS) return null;
  return { prefix: match[1], number: Number(digits), width: digits.length, code };
}

/** Série dominante do tipo; `null` quando nenhum código termina em número. */
export function resolveInventoryItemCodeSequence(
  typeCodes: readonly string[]
): InventoryItemCodeSequence | null {
  const series = new Map<string, { count: number; last: ParsedCode }>();
  for (const raw of typeCodes) {
    const parsed = parseSequentialCode(raw);
    if (!parsed) continue;
    const key = parsed.prefix.toUpperCase();
    const current = series.get(key);
    if (!current) {
      series.set(key, { count: 1, last: parsed });
      continue;
    }
    current.count += 1;
    if (parsed.number > current.last.number) current.last = parsed;
  }

  let best: { count: number; last: ParsedCode } | null = null;
  for (const candidate of series.values()) {
    if (
      !best ||
      candidate.count > best.count ||
      (candidate.count === best.count && candidate.last.number > best.last.number)
    ) {
      best = candidate;
    }
  }
  if (!best) return null;

  return {
    prefix: best.last.prefix,
    lastCode: best.last.code,
    lastNumber: best.last.number,
    width: best.last.width,
    seriesCount: best.count,
  };
}

export function formatInventoryItemSequenceCode(
  sequence: Pick<InventoryItemCodeSequence, "prefix" | "width">,
  number: number
): string {
  return `${sequence.prefix}${String(number).padStart(sequence.width, "0")}`;
}

/**
 * Próximo código livre da série. `takenCodes` são os códigos já usados em qualquer tipo
 * (o código é único no cadastro inteiro); a comparação ignora maiúsculas/minúsculas.
 */
export function suggestNextInventoryItemCode(
  typeCodes: readonly string[],
  takenCodes: readonly string[] = typeCodes
): InventoryItemCodeSuggestion | null {
  const sequence = resolveInventoryItemCodeSequence(typeCodes);
  if (!sequence) return null;

  const taken = new Set<string>();
  for (const code of typeCodes) taken.add(String(code ?? "").trim().toUpperCase());
  for (const code of takenCodes) taken.add(String(code ?? "").trim().toUpperCase());

  let next = sequence.lastNumber + 1;
  let code = formatInventoryItemSequenceCode(sequence, next);
  while (taken.has(code.toUpperCase())) {
    next += 1;
    code = formatInventoryItemSequenceCode(sequence, next);
  }
  return { ...sequence, code };
}

/** Sigla do tipo usada quando o tipo ainda não tem nenhum código com sigla própria. */
export const INVENTORY_ITEM_TYPE_DEFAULT_CODE_PREFIX: Record<InventoryItemType, string> = {
  FINISHED_PRODUCT: "PA",
  SEMI_FINISHED: "SA",
  COMPONENT: "CP",
  RAW_MATERIAL: "MP",
  PACKAGING: "EMB",
  PRODUCTION_SUPPLY: "SUP",
  ADMINISTRATIVE_SUPPLY: "ADM",
  MAINTENANCE: "MAN",
  PPE: "EPI",
  TOOLING: "FER",
  OTHER: "OUT",
};

/** Dígitos de uma série nova (`ADM-INF-0001`). */
const NEW_SEQUENCE_WIDTH = 4;
const FAMILY_ABBREVIATION_LENGTH = 3;
/** Prefixo com sigla de família: `TIPO-FAM-`. */
const FAMILY_SERIES_PREFIX_RE = /^[A-Za-z0-9]+-[A-Za-z0-9]+-$/;

function normalizeFamilyKey(family: string | null | undefined): string {
  return String(family ?? "").trim().toUpperCase();
}

/** Sigla da família: 3 primeiras letras sem acento (`Informática` → `INF`). */
export function abbreviateInventoryFamily(family: string | null | undefined): string {
  return String(family ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, FAMILY_ABBREVIATION_LENGTH)
    .toUpperCase();
}

/** Sigla mais usada nos códigos do tipo (`ADM-...`); sem códigos com sigla, a sigla padrão. */
export function resolveInventoryItemTypeCodePrefix(
  itemType: InventoryItemType,
  typeCodes: readonly string[]
): string {
  const counts = new Map<string, number>();
  for (const code of typeCodes) {
    const match = /^([A-Za-z]{2,5})-/.exec(String(code ?? "").trim());
    if (!match) continue;
    const key = match[1].toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [key, count] of counts) {
    if (best == null || count > (counts.get(best) ?? 0)) best = key;
  }
  return best ?? INVENTORY_ITEM_TYPE_DEFAULT_CODE_PREFIX[itemType];
}

export type InventoryItemCodeProposal = {
  code: string;
  /** Último código da série; `null` quando o código inaugura a série. */
  lastCode: string | null;
  prefix: string;
};

function hasFamilySeriesPrefix(code: string): boolean {
  const parsed = parseSequentialCode(code);
  return parsed != null && FAMILY_SERIES_PREFIX_RE.test(parsed.prefix);
}

/** Continua a série de um prefixo exato (qualquer tipo/família) ou a inaugura em 0001. */
function proposeForPrefix(prefix: string, allCodes: readonly string[]): InventoryItemCodeProposal {
  const key = prefix.toUpperCase();
  const samePrefix = allCodes.filter((code) => parseSequentialCode(code)?.prefix.toUpperCase() === key);
  const continued = suggestNextInventoryItemCode(samePrefix, allCodes);
  if (continued) return { code: continued.code, lastCode: continued.lastCode, prefix: continued.prefix };
  return {
    code: formatInventoryItemSequenceCode({ prefix, width: NEW_SEQUENCE_WIDTH }, 1),
    lastCode: null,
    prefix,
  };
}

/**
 * Código sugerido para um item novo do tipo (e família, quando informada).
 * `typeItems` são os itens já cadastrados no tipo; `allCodes`, todos os códigos do cadastro
 * (o código é único entre tipos).
 */
export function proposeInventoryItemCode(input: {
  itemType: InventoryItemType;
  family?: string | null;
  typeItems: readonly { code: string; family?: string | null }[];
  allCodes: readonly string[];
}): InventoryItemCodeProposal {
  const typeCodes = input.typeItems.map((item) => item.code);
  const typePrefix = resolveInventoryItemTypeCodePrefix(input.itemType, typeCodes);
  const familyKey = normalizeFamilyKey(input.family);
  const familyAbbreviation = abbreviateInventoryFamily(input.family);

  if (familyKey && familyAbbreviation) {
    // Família que já tem série própria mantém a sigla com que foi cadastrada.
    const familySeries = suggestNextInventoryItemCode(
      input.typeItems
        .filter((item) => normalizeFamilyKey(item.family) === familyKey)
        .map((item) => item.code)
        .filter(hasFamilySeriesPrefix),
      input.allCodes
    );
    if (familySeries) {
      return { code: familySeries.code, lastCode: familySeries.lastCode, prefix: familySeries.prefix };
    }
    return proposeForPrefix(`${typePrefix}-${familyAbbreviation}-`, input.allCodes);
  }

  const typeSeries = suggestNextInventoryItemCode(
    typeCodes.filter((code) => !hasFamilySeriesPrefix(code)),
    input.allCodes
  );
  if (typeSeries) {
    return { code: typeSeries.code, lastCode: typeSeries.lastCode, prefix: typeSeries.prefix };
  }
  return proposeForPrefix(`${typePrefix}-`, input.allCodes);
}
