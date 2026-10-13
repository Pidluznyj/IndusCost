/**
 * Próximo código interno de item por tipo — puro (sem Prisma).
 *
 * Não há prefixo fixo por tipo: a sequência é lida dos códigos já cadastrados no tipo.
 * Cada código é quebrado em "prefixo + número final" (ex.: `ADM-0042` → `ADM-` + 42);
 * vale a série (prefixo) com mais itens e o próximo código é o maior número + 1,
 * preservando o preenchimento com zeros do último código.
 */

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
