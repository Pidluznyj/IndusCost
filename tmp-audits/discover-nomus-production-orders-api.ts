/**
 * Descoberta controlada — API Nomus Ordem de Produção (read-only).
 *
 * Cursor/agente NÃO deve rodar isto contra produção automaticamente.
 * Usuário roda no servidor com .env local.
 *
 * Não grava no banco. Não cria tabela. Não altera sync oficial.
 * OP permanece camada opcional para o Funil Pedido → Caixa.
 *
 * Uso:
 *   npx tsx tmp-audits/discover-nomus-production-orders-api.ts
 *   npx tsx tmp-audits/discover-nomus-production-orders-api.ts --salesOrderCode "PD 02339" --verbose
 *   npx tsx tmp-audits/discover-nomus-production-orders-api.ts --salesOrderExternalId 12345 --limit 5
 */
import "dotenv/config";
import {
  buildNomusHeaders,
  buildNomusUrl,
  describeNomusCredential,
  redactHeadersForLog,
  redactNomusUrlForLog,
  sanitizeNomusErrorBody,
} from "../src/lib/nomusRestClient.ts";

const LOG_PREFIX = "[discover-nomus-op]";

/** Paths relativos a NOMUS_BASE_URL (que tipicamente já termina em /rest/). */
const CANDIDATE_ENDPOINTS: Array<{ path: string; query?: Record<string, string> }> = [
  { path: "ordens" },
  { path: "ordensProducao" },
  { path: "ordensDeProducao" },
  { path: "ordens-producao" },
  { path: "ordensProducao", query: { pagina: "1" } },
  { path: "ordemProducao" },
  { path: "ordensFabricacao" },
  { path: "ordens-fabricacao" },
  { path: "producao/ordens" },
];

const PRODUCTION_FIELD_HINTS = [
  "ordemProducao",
  "ordensProducao",
  "ordensProducaoPedido",
  "ordensDeProducao",
  "idOrdemProducao",
  "itensOrdemProducao",
  "atendidoPelaProducao",
  "qtdeAtendidaProducao",
  "quantidadeAtendidaProducao",
  "statusProducao",
  "producao",
  "ops",
  "op",
  "productionOrders",
] as const;

type Classification =
  | "CONFIRMADO"
  | "POSSIVEL"
  | "INDISPONIVEL"
  | "INCONCLUSIVO";

type SoftFetchResult = {
  status: number;
  ok: boolean;
  payload: unknown;
  errorSnippet: string | null;
  networkError: boolean;
};

type EndpointRow = {
  endpoint: string;
  status: string;
  resultado: string;
  camposDetectados: string;
  observacao: string;
  classification: Classification;
};

type CliOptions = {
  salesOrderExternalId: number | null;
  salesOrderCode: string | null;
  limit: number;
  verbose: boolean;
};

function parseCli(argv: string[]): CliOptions {
  let salesOrderExternalId: number | null = null;
  let salesOrderCode: string | null = null;
  let limit = 3;
  let verbose = false;

  for (const arg of argv) {
    if (arg === "--verbose" || arg === "-v") {
      verbose = true;
      continue;
    }
    if (arg.startsWith("--salesOrderExternalId=")) {
      const n = Number.parseInt(arg.slice("--salesOrderExternalId=".length), 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`salesOrderExternalId inválido: ${arg}`);
      salesOrderExternalId = n;
      continue;
    }
    if (arg.startsWith("--salesOrderCode=")) {
      salesOrderCode = arg.slice("--salesOrderCode=".length).trim() || null;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const n = Number.parseInt(arg.slice("--limit=".length), 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`limit inválido: ${arg}`);
      limit = Math.min(n, 20);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return { salesOrderExternalId, salesOrderCode, limit, verbose };
}

function printHelp(): void {
  console.log(`
Uso:
  npx tsx tmp-audits/discover-nomus-production-orders-api.ts [opções]

Opções:
  --salesOrderExternalId=N   Filtra/inspeciona pedido pelo id Nomus
  --salesOrderCode="PD …"    Filtra/inspeciona pedido pelo código
  --limit=N                  Amostra de registros (default 3, máx 20)
  --verbose                  Imprime amostra sanitizada do payload

Requer no .env: NOMUS_BASE_URL e auth (NOMUS_TOKEN e/ou NOMUS_AUTH_HEADER_*).
Não grava no banco. Não chama produção a partir do agente Cursor.
`);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const obj = asObject(payload);
  if (!obj) return [];
  const candidates = [
    obj.ordens,
    obj.ordensProducao,
    obj.ordemProducao,
    obj.ordensDeProducao,
    obj.ordensFabricacao,
    obj.pedidos,
    obj.data,
    obj.results,
    obj.items,
    obj.content,
    asObject(obj.data)?.ordens,
    asObject(obj.data)?.ordensProducao,
    asObject(obj.data)?.pedidos,
    asObject(obj.data)?.items,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function collectKeys(value: unknown, depth = 0, out = new Set<string>()): Set<string> {
  if (depth > 4 || value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 5)) collectKeys(item, depth + 1, out);
    return out;
  }
  const obj = asObject(value);
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj)) {
    out.add(k);
    collectKeys(v, depth + 1, out);
  }
  return out;
}

function findProductionHints(keys: Set<string>): string[] {
  const lower = new Map([...keys].map((k) => [k.toLowerCase(), k]));
  const found: string[] = [];
  for (const hint of PRODUCTION_FIELD_HINTS) {
    const hit = lower.get(hint.toLowerCase());
    if (hit) found.push(hit);
  }
  for (const k of keys) {
    if (/produc|ordem.*prod|ops?\b/i.test(k) && !found.includes(k)) {
      found.push(k);
    }
  }
  return found.slice(0, 24);
}

function hasSalesOrderLinkHints(keys: Set<string>): boolean {
  const joined = [...keys].join(" ").toLowerCase();
  return /pedido|idpedido|salesorder|codigopedido|numeropedido/.test(joined);
}

const SENSITIVE_KEY_RE = /(AUTH|TOKEN|KEY|SECRET|PASSWORD|SENHA|CPF|CNPJ|EMAIL|TELEFONE|PHONE)/i;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[max-depth]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  }
  if (Array.isArray(value)) {
    const max = 4;
    const sliced = value.slice(0, max).map((item) => sanitizeValue(item, depth + 1));
    if (value.length > max) sliced.push(`…[+${value.length - max}]`);
    return sliced;
  }
  const obj = asObject(value);
  if (!obj) return String(value);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? "<redigido>" : sanitizeValue(v, depth + 1);
  }
  return out;
}

async function softGet(url: URL): Promise<SoftFetchResult> {
  const headers = buildNomusHeaders();
  try {
    const res = await fetch(url, { method: "GET", headers });
    const text = await res.text().catch(() => "");
    let payload: unknown = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { _nonJsonBody: sanitizeNomusErrorBody(text, 200) };
      }
    }
    return {
      status: res.status,
      ok: res.ok,
      payload,
      errorSnippet: res.ok ? null : sanitizeNomusErrorBody(text, 200),
      networkError: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: 0,
      ok: false,
      payload: null,
      errorSnippet: sanitizeNomusErrorBody(msg, 200),
      networkError: true,
    };
  }
}

function classifyEndpoint(result: SoftFetchResult, keys: Set<string>, rowCount: number): Classification {
  if (result.networkError) return "INCONCLUSIVO";
  if (result.status === 401 || result.status === 403) return "INCONCLUSIVO";
  if (result.status === 404 || result.status === 405) return "INDISPONIVEL";
  if (result.status >= 500) return "INCONCLUSIVO";
  if (!result.ok) return "INDISPONIVEL";
  const hints = findProductionHints(keys);
  const linked = hasSalesOrderLinkHints(keys);
  if (rowCount > 0 && hints.length > 0 && linked) return "CONFIRMADO";
  if (rowCount > 0 && (hints.length > 0 || linked)) return "POSSIVEL";
  if (result.ok && rowCount === 0) return "POSSIVEL";
  return "POSSIVEL";
}

function endpointLabel(path: string, query?: Record<string, string>): string {
  const q =
    query && Object.keys(query).length > 0
      ? `?${Object.entries(query)
          .map(([k, v]) => `${k}=${v}`)
          .join("&")}`
      : "";
  return `/rest/${path}${q}`;
}

async function probeCandidates(
  baseUrl: string,
  limit: number,
  verbose: boolean
): Promise<EndpointRow[]> {
  const rows: EndpointRow[] = [];
  for (const candidate of CANDIDATE_ENDPOINTS) {
    const url = buildNomusUrl(baseUrl, candidate.path, candidate.query);
    const label = endpointLabel(candidate.path, candidate.query);
    const result = await softGet(url);
    const arr = pickArray(result.payload);
    const sample = arr.slice(0, limit);
    const keys = collectKeys(sample.length > 0 ? sample : result.payload);
    const hints = findProductionHints(keys);
    const classification = classifyEndpoint(result, keys, arr.length);

    let resultado = "sem dados";
    if (result.networkError) resultado = "erro de rede";
    else if (result.status === 401 || result.status === 403) resultado = "não autorizado";
    else if (result.status === 404) resultado = "não encontrado";
    else if (result.status >= 500) resultado = "erro servidor";
    else if (result.ok) resultado = arr.length > 0 ? `${arr.length}+ registros` : "200 vazio/lista";
    else resultado = `HTTP ${result.status}`;

    const observacao =
      result.errorSnippet ??
      (hasSalesOrderLinkHints(keys)
        ? "campos sugerem vínculo com pedido"
        : hints.length > 0
          ? "campos de produção sem vínculo claro a pedido"
          : result.ok
            ? "responder OK — inspecionar schema"
            : "");

    rows.push({
      endpoint: label,
      status: result.networkError ? "NET" : String(result.status),
      resultado,
      camposDetectados: hints.length > 0 ? hints.join(", ") : "(nenhum hint OP)",
      observacao,
      classification,
    });

    console.log(
      `${label.padEnd(42)} | ${String(result.networkError ? "NET" : result.status).padEnd(4)} | ${resultado.padEnd(18)} | ${hints.slice(0, 4).join(",") || "—"} | ${classification}`
    );

    if (verbose && result.ok && sample.length > 0) {
      console.log(
        `  amostra sanitizada:\n${JSON.stringify(sanitizeValue(sample[0]), null, 2).slice(0, 1200)}`
      );
    }
  }
  return rows;
}

function pedidoMatches(
  row: Record<string, unknown>,
  opts: { externalId: number | null; code: string | null }
): boolean {
  if (opts.externalId != null) {
    const id = Number(row.id ?? row.idPedido ?? row.externalId);
    if (Number.isFinite(id) && id === opts.externalId) return true;
  }
  if (opts.code) {
    const code = String(
      row.codigo ?? row.numero ?? row.codigoPedido ?? row.orderCode ?? ""
    )
      .trim()
      .toLowerCase();
    const want = opts.code.trim().toLowerCase();
    if (code && (code === want || code.includes(want.replace(/\s+/g, "")) || want.includes(code))) {
      return true;
    }
    // comparação tolerante a espaços
    if (code.replace(/\s+/g, "") === want.replace(/\s+/g, "")) return true;
  }
  return false;
}

async function probeSalesOrder(
  baseUrl: string,
  opts: CliOptions
): Promise<void> {
  console.log("\n--- Inspeção de Pedido (campos de produção embutidos) ---");
  if (!opts.salesOrderExternalId && !opts.salesOrderCode) {
    console.log(
      "Sem --salesOrderExternalId/--salesOrderCode: varrendo primeira página de /rest/pedidos (amostra)."
    );
  }

  const url = buildNomusUrl(baseUrl, "pedidos", { pagina: "1" });
  const result = await softGet(url);
  if (!result.ok) {
    console.log(
      `pedidos | ${result.status || "NET"} | falha | — | ${result.errorSnippet ?? "indisponível"}`
    );
    return;
  }

  const pedidos = pickArray(result.payload).map(asObject).filter(Boolean) as Record<
    string,
    unknown
  >[];
  let targets = pedidos;
  if (opts.salesOrderExternalId != null || opts.salesOrderCode) {
    targets = pedidos.filter((p) =>
      pedidoMatches(p, {
        externalId: opts.salesOrderExternalId,
        code: opts.salesOrderCode,
      })
    );
    if (targets.length === 0 && opts.salesOrderExternalId != null) {
      // tentativa pontual por query comum
      const byId = buildNomusUrl(baseUrl, "pedidos", {
        id: String(opts.salesOrderExternalId),
        pagina: "1",
      });
      const r2 = await softGet(byId);
      if (r2.ok) {
        const arr = pickArray(r2.payload).map(asObject).filter(Boolean) as Record<
          string,
          unknown
        >[];
        targets = arr.filter((p) =>
          pedidoMatches(p, { externalId: opts.salesOrderExternalId, code: null })
        );
        if (targets.length === 0 && arr.length > 0) targets = arr.slice(0, 1);
      }
    }
  }

  const sample = targets.slice(0, Math.max(1, opts.limit));
  if (sample.length === 0) {
    console.log(
      "Nenhum pedido na amostra. Informe --salesOrderCode ou --salesOrderExternalId no servidor com dados."
    );
    return;
  }

  for (const pedido of sample) {
    const code = String(pedido.codigo ?? pedido.numero ?? pedido.codigoPedido ?? "?");
    const id = pedido.id ?? pedido.idPedido ?? "?";
    const keys = collectKeys(pedido);
    const hints = findProductionHints(keys);
    console.log(
      `pedido ${code} (id=${id}) | hints OP: ${hints.length > 0 ? hints.join(", ") : "(nenhum)"}`
    );
    if (opts.verbose) {
      const slim: Record<string, unknown> = {};
      for (const h of hints) {
        if (h in pedido) slim[h] = sanitizeValue(pedido[h]);
      }
      for (const k of ["id", "codigo", "numero", "status", "situacao"]) {
        if (k in pedido) slim[k] = sanitizeValue(pedido[k]);
      }
      console.log(JSON.stringify(slim, null, 2).slice(0, 2000));
    }
  }
}

function finalClassification(rows: EndpointRow[]): Classification {
  if (rows.some((r) => r.classification === "CONFIRMADO")) return "CONFIRMADO";
  if (rows.every((r) => r.classification === "INDISPONIVEL")) return "INDISPONIVEL";
  if (rows.some((r) => r.classification === "INCONCLUSIVO") &&
      !rows.some((r) => r.classification === "POSSIVEL" || r.classification === "CONFIRMADO")) {
    return "INCONCLUSIVO";
  }
  if (rows.some((r) => r.classification === "POSSIVEL")) return "POSSIVEL";
  return "INCONCLUSIVO";
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));

  console.log("=== Descoberta API Nomus — Ordem de Produção ===");
  console.log("Modo: GET read-only | sem write | OP opcional para o funil\n");

  const baseUrl = (process.env.NOMUS_BASE_URL ?? "").trim();
  if (!baseUrl) {
    console.error(
      `${LOG_PREFIX} NOMUS_BASE_URL ausente. Configure o .env no servidor e rode novamente.`
    );
    console.error("Classificação final: INCONCLUSIVO");
    process.exitCode = 2;
    return;
  }

  const tokenDesc = describeNomusCredential(process.env.NOMUS_TOKEN);
  const headerName = (process.env.NOMUS_AUTH_HEADER_NAME ?? "").trim();
  const headerValueDesc = describeNomusCredential(process.env.NOMUS_AUTH_HEADER_VALUE);
  console.log("Auth (sanitizado):");
  console.log(
    `  NOMUS_BASE_URL: ${redactNomusUrlForLog(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)}`
  );
  console.log(
    `  NOMUS_TOKEN: present=${tokenDesc.present} len=${tokenDesc.length} hash12=${tokenDesc.hash12 ?? "—"}`
  );
  console.log(
    `  NOMUS_AUTH_HEADER: name=${headerName || "—"} valuePresent=${headerValueDesc.present}`
  );
  console.log(
    `  headers enviados: ${JSON.stringify(redactHeadersForLog(buildNomusHeaders()))}`
  );
  console.log("");

  if (!tokenDesc.present && !(headerName && headerValueDesc.present)) {
    console.error(`${LOG_PREFIX} Nenhuma credencial Nomus configurada.`);
    console.error("Classificação final: INCONCLUSIVO");
    process.exitCode = 2;
    return;
  }

  console.log("endpoint | status | resultado | campos detectados | classificação");
  console.log("-".repeat(100));
  const rows = await probeCandidates(baseUrl, opts.limit, opts.verbose);
  await probeSalesOrder(baseUrl, opts);

  const final = finalClassification(rows);
  console.log("\n=== Classificação final ===");
  console.log(final);
  console.log(
    final === "CONFIRMADO"
      ? "Há endpoint 200 com dados e hints de OP/vínculo — enriquecer funil como camada opcional."
      : final === "POSSIVEL"
        ? "API responde em algum path, mas vínculo pedido↔OP ainda não está claro — validar amostra no servidor."
        : final === "INDISPONIVEL"
          ? "Endpoints candidatos não encontrados/autorizados — funil segue sem OP obrigatória."
          : "Erro técnico ou credencial — reexecutar no servidor com .env válido."
  );
  console.log(
    "\nLembrete: Funil Pedido → Caixa NÃO depende de Ordem de Produção. OP é camada opcional."
  );
}

main().catch((e) => {
  console.error(LOG_PREFIX, e instanceof Error ? e.message : e);
  console.error("Classificação final: INCONCLUSIVO");
  process.exitCode = 1;
});
