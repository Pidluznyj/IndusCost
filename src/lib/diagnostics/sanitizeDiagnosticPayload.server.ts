/**
 * Sanitização central para ChatGPT Analyzable Diagnostic Bundle.
 * Remove/mascara segredos antes de exportar ZIP read-only.
 */
import type { DiagnosticRedactionReport } from "./chatgptDiagnosticTypes.js";

export const REDACTION_MASK_PREFIX = "[REDACTED:";
export const REDACTION_MASK_SUFFIX = "]";

export const MAX_DIAGNOSTIC_STACK_LINES = 20;

export const SENSITIVE_FIELD_NAMES = [
  "password",
  "senha",
  "token",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "jwt",
  "bearer",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "databaseurl",
  "database_url",
  "connectionstring",
  "connection_string",
  "smtp",
  "mailpassword",
  "mail_password",
  "nomustoken",
  "nomus_token",
  "clientsecret",
  "client_secret",
  "privatekey",
  "private_key",
  "nomus_auth_header_value",
  "gemini_api_key",
] as const;

const SENSITIVE_KEY_REGEX = new RegExp(
  SENSITIVE_FIELD_NAMES.map((n) => n.replace(/_/g, "[_\\-]?")).join("|"),
  "i"
);

const TEXT_REDACTION_RULES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, label: "AUTHORIZATION" },
  { pattern: /Authorization:\s*[^\n\r]+/gi, label: "AUTHORIZATION" },
  { pattern: /Cookie:\s*[^\n\r]+/gi, label: "COOKIE" },
  { pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, label: "JWT" },
  { pattern: /DATABASE_URL\s*=\s*[^\s\n\r"']+/gi, label: "DATABASE_URL" },
  { pattern: /postgresql:\/\/[^\s\n\r"']+/gi, label: "DATABASE_URL" },
  { pattern: /mongodb(\+srv)?:\/\/[^\s\n\r"']+/gi, label: "DATABASE_URL" },
  { pattern: /mysql:\/\/[^\s\n\r"']+/gi, label: "DATABASE_URL" },
  { pattern: /sk-[A-Za-z0-9]{10,}/g, label: "API_KEY" },
  { pattern: /(?:api[_-]?key|x-api-key)\s*[:=]\s*[^\s\n\r,]+/gi, label: "API_KEY" },
  { pattern: /\.env(?:\.\w+)?/g, label: "ENV_FILE" },
];

const FORBIDDEN_BUNDLE_SUBSTRINGS = [
  "Bearer ",
  "DATABASE_URL=",
  "postgresql://",
  "mongodb://",
  "mongodb+srv://",
] as const;

export type DiagnosticSanitizationContext = {
  redactedFieldsCount: number;
  redactedPatterns: Set<string>;
  filesSanitized: Set<string>;
  warnings: string[];
  redactedKeys: string[];
};

export function createSanitizationContext(): DiagnosticSanitizationContext {
  return {
    redactedFieldsCount: 0,
    redactedPatterns: new Set<string>(),
    filesSanitized: new Set<string>(),
    warnings: [],
    redactedKeys: [],
  };
}

export function redactionMask(fieldName: string): string {
  const normalized = fieldName
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return `${REDACTION_MASK_PREFIX}${normalized || "SECRET"}${REDACTION_MASK_SUFFIX}`;
}

function recordRedaction(
  ctx: DiagnosticSanitizationContext,
  label: string,
  keyPath?: string
): void {
  ctx.redactedFieldsCount += 1;
  ctx.redactedPatterns.add(label.toLowerCase());
  if (keyPath) ctx.redactedKeys.push(keyPath);
}

export function sanitizeDiagnosticText(
  input: string,
  ctx: DiagnosticSanitizationContext = createSanitizationContext()
): string {
  let out = input;
  for (const rule of TEXT_REDACTION_RULES) {
    out = out.replace(rule.pattern, () => {
      recordRedaction(ctx, rule.label, "text");
      return redactionMask(rule.label);
    });
  }
  return out;
}

export function sanitizeDiagnosticHeaders(
  input: Record<string, unknown>,
  ctx: DiagnosticSanitizationContext = createSanitizationContext()
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const lower = key.toLowerCase();
    if (
      lower === "authorization" ||
      lower === "cookie" ||
      lower === "set-cookie" ||
      lower === "x-api-key" ||
      SENSITIVE_KEY_REGEX.test(key)
    ) {
      recordRedaction(ctx, key, `headers.${key}`);
      out[key] = redactionMask(key);
      continue;
    }
    if (typeof value === "string") {
      out[key] = sanitizeDiagnosticText(value, ctx);
    } else if (Array.isArray(value)) {
      out[key] = value.map((v) =>
        typeof v === "string" ? sanitizeDiagnosticText(v, ctx) : v
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function sanitizeDiagnosticError(
  error: unknown,
  ctx: DiagnosticSanitizationContext = createSanitizationContext()
): Record<string, unknown> {
  if (error == null) {
    return { message: "Unknown error" };
  }

  if (typeof error === "string") {
    return { message: sanitizeDiagnosticText(error, ctx) };
  }

  if (error instanceof Error) {
    const stackLines = error.stack?.split("\n") ?? [];
    const limitedStack = stackLines.slice(0, MAX_DIAGNOSTIC_STACK_LINES);
    if (stackLines.length > MAX_DIAGNOSTIC_STACK_LINES) {
      ctx.warnings.push(
        `Stack trace truncado em ${MAX_DIAGNOSTIC_STACK_LINES} linhas.`
      );
    }
    return sanitizeDiagnosticPayload(
      {
        name: error.name,
        message: error.message,
        stack: limitedStack.join("\n"),
      },
      ctx
    ) as Record<string, unknown>;
  }

  return sanitizeDiagnosticPayload(error, ctx) as Record<string, unknown>;
}

function normalizeSensitiveFieldName(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1_$2");
}

function sanitizeValue(
  value: unknown,
  ctx: DiagnosticSanitizationContext,
  path: string[]
): unknown {
  if (value == null) return value;

  if (typeof value === "string") {
    return sanitizeDiagnosticText(value, ctx);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, ctx, [...path, String(index)]));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = [...path, key];
      const normalizedKey = normalizeSensitiveFieldName(key);

      if (SENSITIVE_KEY_REGEX.test(normalizedKey)) {
        recordRedaction(ctx, key, nextPath.join("."));
        out[key] = redactionMask(key);
        continue;
      }

      if (key === "DATABASE_URL" || key === "databaseUrl") {
        recordRedaction(ctx, "DATABASE_URL", nextPath.join("."));
        out[key] = redactionMask("DATABASE_URL");
        continue;
      }

      out[key] = sanitizeValue(child, ctx, nextPath);
    }
    return out;
  }

  return value;
}

export function sanitizeDiagnosticPayload<T>(
  input: T,
  ctx: DiagnosticSanitizationContext = createSanitizationContext()
): T {
  return sanitizeValue(input, ctx, []) as T;
}

export function createRedactionReport(
  before: unknown,
  after: unknown,
  filesSanitized: string[] = []
): DiagnosticRedactionReport {
  const afterCtx = createSanitizationContext();
  sanitizeDiagnosticPayload(before, afterCtx);
  sanitizeDiagnosticPayload(after, afterCtx);
  for (const file of filesSanitized) {
    afterCtx.filesSanitized.add(file);
  }
  return contextToRedactionReport(afterCtx);
}

export function contextToRedactionReport(
  ctx: DiagnosticSanitizationContext
): DiagnosticRedactionReport {
  return {
    redactedFieldsCount: ctx.redactedFieldsCount,
    redactedPatterns: [...ctx.redactedPatterns].sort(),
    filesSanitized: [...ctx.filesSanitized].sort(),
    warnings: [...ctx.warnings],
    redactedKeys: [...ctx.redactedKeys],
  };
}

export function mergeRedactionReports(
  ...reports: DiagnosticRedactionReport[]
): DiagnosticRedactionReport {
  const merged = createSanitizationContext();
  for (const report of reports) {
    merged.redactedFieldsCount += report.redactedFieldsCount;
    for (const p of report.redactedPatterns) merged.redactedPatterns.add(p);
    for (const f of report.filesSanitized) merged.filesSanitized.add(f);
    for (const w of report.warnings) merged.warnings.push(w);
    for (const k of report.redactedKeys ?? []) merged.redactedKeys.push(k);
  }
  return contextToRedactionReport(merged);
}

export function buildSafeEnvironmentFlags(env: NodeJS.ProcessEnv = process.env): Record<string, boolean> {
  return {
    DATABASE_URL_CONFIGURED: Boolean(env.DATABASE_URL?.trim()),
    NOMUS_API_CONFIGURED: Boolean(
      env.NOMUS_TOKEN?.trim() ||
        env.NOMUS_AUTH_HEADER_VALUE?.trim() ||
        (env.NOMUS_BASE_URL?.trim() && env.NOMUS_AUTH_HEADER_NAME?.trim())
    ),
    GEMINI_API_CONFIGURED: Boolean(env.GEMINI_API_KEY?.trim()),
    SMTP_CONFIGURED: Boolean(env.SMTP_PASSWORD?.trim() || env.MAIL_PASSWORD?.trim()),
  };
}

export function sanitizeDiagnosticLogLines(
  lines: string[],
  ctx: DiagnosticSanitizationContext = createSanitizationContext()
): string {
  if (lines.length === 0) {
    return "# No logs captured in this bundle.\n";
  }
  const limited = lines.slice(0, 2000);
  if (lines.length > 2000) {
    ctx.warnings.push("Logs truncados em 2000 linhas.");
  }
  return limited.map((line) => sanitizeDiagnosticText(line, ctx)).join("\n") + "\n";
}

export function assertBundleContainsNoForbiddenSecrets(content: string): void {
  for (const forbidden of FORBIDDEN_BUNDLE_SUBSTRINGS) {
    if (content.includes(forbidden)) {
      throw new Error(`Bundle contém segredo não mascarado: ${forbidden}`);
    }
  }
  if (/(?:senha|password)\s*[:=]\s*[^\s\[\n\r]{3,}/i.test(content)) {
    throw new Error("Bundle contém senha em texto claro.");
  }
}

export function sanitizeBundleEntry(
  bundlePath: string,
  content: string,
  ctx: DiagnosticSanitizationContext
): string {
  ctx.filesSanitized.add(bundlePath);
  if (bundlePath.endsWith(".log") || bundlePath.endsWith(".md")) {
    return sanitizeDiagnosticText(content, ctx);
  }
  if (bundlePath.endsWith(".json") || bundlePath.endsWith(".jsonl")) {
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(sanitizeDiagnosticPayload(parsed, ctx), null, 2);
    } catch {
      return sanitizeDiagnosticText(content, ctx);
    }
  }
  return sanitizeDiagnosticText(content, ctx);
}
