/**
 * Helpers puros para análise amostral de rawJson de Documentos de Saída (DS-02.4).
 * Não acessa banco. Não inferir significado definitivo — só hipóteses por nome de chave.
 */

export type JsonValueType =
  | "null"
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "unknown";

export type RawJsonFocusArea =
  | "documento"
  | "emissao"
  | "processamento"
  | "empresa"
  | "cliente"
  | "status"
  | "cancelamento"
  | "total"
  | "produtos"
  | "frete"
  | "desconto"
  | "despesas"
  | "tributos"
  | "pedido"
  | "item_pedido"
  | "nfe"
  | "condicao_pagamento"
  | "forma_pagamento"
  | "parcelas"
  | "vencimentos"
  | "valores_parcelas";

export type RawJsonKeyMatrixRow = {
  key: string;
  appearances: number;
  samplePercent: number;
  observedTypes: JsonValueType[];
  sanitizedExamples: string[];
  /** Tags de foco por nome da chave — sempre hipótese até validação no servidor. */
  hypothesisTags: RawJsonFocusArea[];
  classification: "hypothesis";
};

export type RawJsonKeysSection = {
  sampleSize: number;
  documentsScanned: number;
  itemsScanned: number;
  maxDepth: number;
  keys: RawJsonKeyMatrixRow[];
  focusHypotheses: Array<{
    focus: RawJsonFocusArea;
    matchingKeyCount: number;
    matchingKeys: string[];
    note: string;
  }>;
  notes: string[];
};

export type PaymentTermsEvidence = {
  sampleSize: number;
  hypothesisOnly: true;
  candidateKeys: RawJsonKeyMatrixRow[];
  notes: string[];
};

export type RawJsonKeyAccumulator = {
  appearances: number;
  types: Set<JsonValueType>;
  examples: string[];
};

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_EXAMPLES_PER_KEY = 3;
const DEFAULT_EXAMPLE_MAX_CHARS = 120;

/** Padrões de foco — matching por substring no path da chave (hipótese). */
export const RAW_JSON_FOCUS_PATTERNS: Array<{
  focus: RawJsonFocusArea;
  patterns: RegExp[];
}> = [
  {
    focus: "documento",
    patterns: [/documento/i, /\bdocument\b/i, /idDocumento/i],
  },
  {
    focus: "emissao",
    patterns: [/emiss[aã]o/i, /dataEmiss/i, /dhEmi/i, /\bemitid/i],
  },
  {
    focus: "processamento",
    patterns: [/processament/i, /dataProcess/i, /horaProcess/i],
  },
  {
    focus: "empresa",
    patterns: [/empresa/i, /company/i, /emitente/i, /cnpjEmit/i],
  },
  {
    focus: "cliente",
    patterns: [
      /cliente/i,
      /customer/i,
      /destinat/i,
      /\bpessoa\b/i,
      /personName/i,
    ],
  },
  {
    focus: "status",
    patterns: [/\bstatus\b/i, /situa[cç][aã]o/i],
  },
  {
    focus: "cancelamento",
    patterns: [/cancel/i],
  },
  {
    focus: "total",
    patterns: [/valorTotal/i, /\btotal\b/i, /\bvNF\b/i, /\bvProd\b/i],
  },
  {
    focus: "produtos",
    patterns: [/produto/i, /itensDocumento/i, /\bitens\b/i, /\bitems\b/i],
  },
  {
    focus: "frete",
    patterns: [/frete/i, /vFrete/i],
  },
  {
    focus: "desconto",
    patterns: [/desconto/i, /vDesc/i],
  },
  {
    focus: "despesas",
    patterns: [/despesa/i, /vOutro/i, /encarg/i],
  },
  {
    focus: "tributos",
    patterns: [
      /tribut/i,
      /imposto/i,
      /\bicms\b/i,
      /\bipi\b/i,
      /\bpis\b/i,
      /cofins/i,
      /\bfcp\b/i,
    ],
  },
  {
    focus: "pedido",
    patterns: [/pedido/i, /salesOrder/i, /idPedido/i, /orderCode/i],
  },
  {
    focus: "item_pedido",
    patterns: [/itemPedido/i, /idItemPedido/i, /itensPedido/i],
  },
  {
    focus: "nfe",
    patterns: [/\bnfe\b/i, /idNfe/i, /notaFiscal/i, /\bchave\b/i, /nf-e/i],
  },
  {
    focus: "condicao_pagamento",
    patterns: [
      /condi[cç][aã]oPagamento/i,
      /condicaoPagamento/i,
      /paymentCondition/i,
      /paymentTerms/i,
      /\bprazo\b/i,
    ],
  },
  {
    focus: "forma_pagamento",
    patterns: [
      /formaPagamento/i,
      /paymentMethod/i,
      /meioPagamento/i,
      /metodoPagamento/i,
    ],
  },
  {
    focus: "parcelas",
    patterns: [/parcela/i, /installment/i],
  },
  {
    focus: "vencimentos",
    patterns: [/venciment/i, /dueDate/i, /dataVenc/i],
  },
  {
    focus: "valores_parcelas",
    patterns: [/valorParcela/i, /parcela.*valor/i, /valor.*parcela/i],
  },
];

const PAYMENT_FOCUS_AREAS: ReadonlySet<RawJsonFocusArea> = new Set([
  "condicao_pagamento",
  "forma_pagamento",
  "parcelas",
  "vencimentos",
  "valores_parcelas",
]);

export function identifyJsonValueType(value: unknown): JsonValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "string") return "string";
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  if (t === "object") return "object";
  return "unknown";
}

/** Remove não-dígitos. */
export function digitsOnly(input: string): string {
  return input.replace(/\D+/g, "");
}

/**
 * Mascara CPF (11 dígitos). Mantém formato parcial mascarado (asteriscos + 2 dígitos finais).
 * Se não parecer CPF, retorna o original truncado pelo caller.
 */
export function maskCpf(raw: string): string {
  const digits = digitsOnly(raw);
  if (digits.length !== 11) return raw;
  return `***.***.***-${digits.slice(-2)}`;
}

/**
 * Mascara CNPJ (14 dígitos). Mantém formato parcial mascarado (asteriscos + 2 dígitos finais).
 */
export function maskCnpj(raw: string): string {
  const digits = digitsOnly(raw);
  if (digits.length !== 14) return raw;
  return `**.***.***/****-${digits.slice(-2)}`;
}

/**
 * Mascara identificadores sensíveis: CPF, CNPJ, e-mails parciais, tokens longos.
 */
export function maskSensitiveIdentifier(raw: unknown): string {
  if (raw == null) return "null";
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  const text = String(raw);

  const withDocs = text
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, (m) => maskCpf(m))
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, (m) => maskCnpj(m))
    .replace(/\b\d{11}\b/g, (m) => maskCpf(m))
    .replace(/\b\d{14}\b/g, (m) => maskCnpj(m));

  const withEmail = withDocs.replace(
    /([A-Z0-9._%+-]{1,3})[A-Z0-9._%+-]*@([A-Z0-9.-]+\.[A-Z]{2,})/gi,
    "$1***@$2"
  );

  // Tokens / chaves longas alfanuméricas
  return withEmail.replace(
    /\b([A-Za-z0-9_-]{4})[A-Za-z0-9_-]{12,}([A-Za-z0-9_-]{4})\b/g,
    "$1…$2"
  );
}

export function limitExamples<T>(examples: T[], limit: number): T[] {
  const max = Math.max(0, Math.trunc(limit));
  if (max === 0) return [];
  if (examples.length <= max) return examples.slice();
  return examples.slice(0, max);
}

export function sanitizeExampleValue(
  value: unknown,
  maxChars: number = DEFAULT_EXAMPLE_MAX_CHARS
): string {
  const type = identifyJsonValueType(value);
  let rendered: string;
  switch (type) {
    case "null":
      rendered = "null";
      break;
    case "string":
      rendered = maskSensitiveIdentifier(value);
      break;
    case "number":
    case "boolean":
      rendered = String(value);
      break;
    case "array": {
      const arr = value as unknown[];
      rendered = `[array len=${arr.length}]`;
      break;
    }
    case "object": {
      const keys = Object.keys(value as Record<string, unknown>);
      rendered = `{object keys=${keys.length}}`;
      break;
    }
    default:
      rendered = "[unknown]";
  }

  const masked = maskSensitiveIdentifier(rendered);
  const limit = Math.max(16, Math.trunc(maxChars));
  if (masked.length <= limit) return masked;
  return `${masked.slice(0, limit - 1)}…`;
}

export function hypothesizeFocusAreasForKey(keyPath: string): RawJsonFocusArea[] {
  const tags: RawJsonFocusArea[] = [];
  for (const entry of RAW_JSON_FOCUS_PATTERNS) {
    if (entry.patterns.some((re) => re.test(keyPath))) {
      tags.push(entry.focus);
    }
  }
  return tags;
}

function joinKeyPath(parent: string, key: string): string {
  if (!parent) return key;
  if (/^\d+$/.test(key)) return `${parent}[${key}]`;
  return `${parent}.${key}`;
}

export type ExtractJsonKeysOptions = {
  maxDepth?: number;
  /** Quando true, percorre índices de array como [0],[1],… */
  expandArrays?: boolean;
  /** Limite de índices de array expandidos por nível. */
  maxArrayIndexes?: number;
};

/**
 * Extrai caminhos de chaves de um JSON aninhado (sem carregar exemplos aqui).
 * Retorna pares path → tipo observado no nó.
 */
export function extractJsonKeyEntries(
  value: unknown,
  options: ExtractJsonKeysOptions = {}
): Array<{ key: string; type: JsonValueType; value: unknown }> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const expandArrays = options.expandArrays ?? true;
  const maxArrayIndexes = options.maxArrayIndexes ?? 5;
  const out: Array<{ key: string; type: JsonValueType; value: unknown }> = [];

  function walk(node: unknown, path: string, depth: number): void {
    if (depth > maxDepth) return;
    const type = identifyJsonValueType(node);

    if (path) {
      out.push({ key: path, type, value: node });
    }

    if (type === "object") {
      const obj = node as Record<string, unknown>;
      for (const [k, child] of Object.entries(obj)) {
        walk(child, joinKeyPath(path, k), depth + 1);
      }
      return;
    }

    if (type === "array" && expandArrays) {
      const arr = node as unknown[];
      const limit = Math.min(arr.length, maxArrayIndexes);
      for (let i = 0; i < limit; i += 1) {
        walk(arr[i], joinKeyPath(path, String(i)), depth + 1);
      }
    }
  }

  walk(value, "", 0);
  return out;
}

export function createRawJsonKeyAccumulatorMap(): Map<string, RawJsonKeyAccumulator> {
  return new Map();
}

/**
 * Acumula estatísticas de chaves a partir de um payload.
 * Conta aparição por documento/item (cada path conta no máximo 1 vez por payload).
 */
export function accumulateRawJsonKeysFromPayload(
  acc: Map<string, RawJsonKeyAccumulator>,
  payload: unknown,
  options: ExtractJsonKeysOptions & {
    maxExamplesPerKey?: number;
    exampleMaxChars?: number;
  } = {}
): void {
  const maxExamples = options.maxExamplesPerKey ?? DEFAULT_MAX_EXAMPLES_PER_KEY;
  const exampleMaxChars = options.exampleMaxChars ?? DEFAULT_EXAMPLE_MAX_CHARS;
  const entries = extractJsonKeyEntries(payload, options);
  const seenInPayload = new Set<string>();

  for (const entry of entries) {
    if (seenInPayload.has(entry.key)) {
      // Mesmo path repetido no payload (ex.: múltiplos índices) — só tipa/exemplo.
      const existing = acc.get(entry.key);
      if (existing) {
        existing.types.add(entry.type);
        if (existing.examples.length < maxExamples) {
          const example = sanitizeExampleValue(entry.value, exampleMaxChars);
          if (!existing.examples.includes(example)) {
            existing.examples.push(example);
          }
        }
      }
      continue;
    }
    seenInPayload.add(entry.key);

    let bucket = acc.get(entry.key);
    if (!bucket) {
      bucket = { appearances: 0, types: new Set(), examples: [] };
      acc.set(entry.key, bucket);
    }
    bucket.appearances += 1;
    bucket.types.add(entry.type);
    if (bucket.examples.length < maxExamples) {
      const example = sanitizeExampleValue(entry.value, exampleMaxChars);
      if (!bucket.examples.includes(example)) {
        bucket.examples.push(example);
      }
    }
  }
}

export function finalizeRawJsonKeyMatrix(
  acc: Map<string, RawJsonKeyAccumulator>,
  sampleSize: number
): RawJsonKeyMatrixRow[] {
  const safeSample = Math.max(0, Math.trunc(sampleSize));
  const rows: RawJsonKeyMatrixRow[] = [];

  for (const [key, bucket] of acc.entries()) {
    const appearances = bucket.appearances;
    const samplePercent =
      safeSample > 0
        ? Math.round((appearances / safeSample) * 10000) / 100
        : 0;
    rows.push({
      key,
      appearances,
      samplePercent,
      observedTypes: [...bucket.types].sort(),
      sanitizedExamples: limitExamples(bucket.examples, DEFAULT_MAX_EXAMPLES_PER_KEY),
      hypothesisTags: hypothesizeFocusAreasForKey(key),
      classification: "hypothesis",
    });
  }

  rows.sort((a, b) => {
    if (b.appearances !== a.appearances) return b.appearances - a.appearances;
    return a.key.localeCompare(b.key);
  });
  return rows;
}

export function buildFocusHypotheses(
  rows: RawJsonKeyMatrixRow[]
): RawJsonKeysSection["focusHypotheses"] {
  const byFocus = new Map<RawJsonFocusArea, string[]>();
  for (const row of rows) {
    for (const tag of row.hypothesisTags) {
      const list = byFocus.get(tag) ?? [];
      list.push(row.key);
      byFocus.set(tag, list);
    }
  }

  const focuses = RAW_JSON_FOCUS_PATTERNS.map((p) => p.focus);
  return focuses.map((focus) => {
    const matchingKeys = limitExamples(byFocus.get(focus) ?? [], 25);
    return {
      focus,
      matchingKeyCount: (byFocus.get(focus) ?? []).length,
      matchingKeys,
      note: "Hipótese baseada apenas no nome da chave — validar no servidor antes de normalizar.",
    };
  });
}

export function buildPaymentTermsEvidence(
  rows: RawJsonKeyMatrixRow[],
  sampleSize: number
): PaymentTermsEvidence {
  const candidateKeys = rows.filter((row) =>
    row.hypothesisTags.some((tag) => PAYMENT_FOCUS_AREAS.has(tag))
  );
  return {
    sampleSize,
    hypothesisOnly: true,
    candidateKeys,
    notes: [
      "Evidências de condição/forma/parcelas/vencimentos são hipóteses por nome de chave.",
      "Não tratar como fonte financeira oficial — CR (NomusAccountsReceivable) permanece a verdade de recebíveis.",
      "Ausência de chaves candidatas na amostra não prova ausência no payload completo do Nomus.",
    ],
  };
}

export function buildRawJsonKeysSection(input: {
  sampleSize: number;
  documentsScanned: number;
  itemsScanned: number;
  maxDepth: number;
  rows: RawJsonKeyMatrixRow[];
}): RawJsonKeysSection {
  return {
    sampleSize: input.sampleSize,
    documentsScanned: input.documentsScanned,
    itemsScanned: input.itemsScanned,
    maxDepth: input.maxDepth,
    keys: input.rows,
    focusHypotheses: buildFocusHypotheses(input.rows),
    notes: [
      "Matriz gerada por amostragem paginada — não representa 100% do stage.",
      "Exemplos são sanitizados (CPF/CNPJ/e-mail/token) e truncados; payloads completos não são exportados.",
      "classification=hypothesis para todas as chaves até validação no servidor.",
    ],
  };
}

export function buildEmptyRawJsonKeysSection(): RawJsonKeysSection {
  return buildRawJsonKeysSection({
    sampleSize: 0,
    documentsScanned: 0,
    itemsScanned: 0,
    maxDepth: DEFAULT_MAX_DEPTH,
    rows: [],
  });
}

export function buildEmptyPaymentTermsEvidence(): PaymentTermsEvidence {
  return buildPaymentTermsEvidence([], 0);
}

export const RAW_JSON_ANALYSIS_DEFAULTS = {
  maxDepth: DEFAULT_MAX_DEPTH,
  maxExamplesPerKey: DEFAULT_MAX_EXAMPLES_PER_KEY,
  exampleMaxChars: DEFAULT_EXAMPLE_MAX_CHARS,
  pageSize: 50,
} as const;
