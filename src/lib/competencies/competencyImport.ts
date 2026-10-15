/**
 * Competências e Desenvolvimento — importação assistida de níveis por planilha (regra PURA).
 *
 * Layout (o mesmo do modelo baixado em "Baixar modelo"):
 *   ID | Colaborador | Posto | <competência 1> | <competência 2> | ...
 * - "Colaborador" é obrigatório; "ID" (uuid do colaborador) é opcional e, quando presente,
 *   tem precedência sobre o nome; "Posto" é só informativo.
 * - Demais colunas = competências do catálogo, casadas por nome (sem acento/maiúsculas).
 *
 * Regras:
 * - Célula VAZIA nunca altera nada (inclusive não zera).
 * - Valores aceitos: 0–4 ou o nome do nível ("Proficiente"...). Outro valor → célula inválida, ignorada.
 * - Conflito (precisa de decisão; padrão = manter o atual):
 *     DOWNGRADE  — valor do arquivo menor que o nível atual;
 *     ASSESSED   — nível atual veio de avaliação formal e o arquivo traz outro valor.
 * - Conciliação de colaboradores: ID → nome exato normalizado. Mais de um nome igual = ambíguo
 *   (escolha manual entre os candidatos); não encontrado pode ser associado manualmente.
 *   Quem está fora do escopo do usuário não é revelado (vira "não encontrado"); o próprio
 *   líder (visível, não gravável) aparece como "fora da sua equipe".
 * - Linha repetida para o mesmo colaborador: só a primeira vale; as demais são ignoradas.
 * - Idempotência: reaplicar o mesmo arquivo não gera alteração (células iguais = "sem alteração").
 */
import {
  COMPETENCY_LEVEL_LABELS,
  isCompetencyLevel,
  type CompetencyLevel,
} from "./competencyDomain";

export const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_COLUMNS = 200;

export const IMPORT_HEADER_ID = "ID";
export const IMPORT_HEADER_EMPLOYEE = "Colaborador";
export const IMPORT_HEADER_POSITION = "Posto";

export type ImportContext = {
  competencies: { id: string; name: string }[];
  /** Colaboradores ATIVOS visíveis no escopo do usuário. */
  employees: { id: string; name: string; writable: boolean }[];
  levels: { employeeId: string; competencyId: string; level: number; source: string }[];
};

export type ImportColumn = {
  index: number;
  header: string;
  kind: "ID" | "EMPLOYEE" | "POSITION" | "COMPETENCY" | "UNKNOWN" | "DUPLICATE";
  competencyId: string | null;
};

export type RowMatchStatus = "MATCHED" | "AMBIGUOUS" | "NOT_FOUND" | "OUT_OF_SCOPE" | "DUPLICATE_ROW" | "EMPTY_NAME";

export type ImportCellKind = "EMPTY" | "UNCHANGED" | "CHANGE" | "CONFLICT" | "INVALID";
export type ConflictReason = "DOWNGRADE" | "ASSESSED";

export type ImportCell = {
  competencyId: string;
  raw: string;
  value: CompetencyLevel | null;
  current: number;
  currentSource: string | null;
  kind: ImportCellKind;
  conflictReason: ConflictReason | null;
};

export type ImportRow = {
  rowNumber: number;
  sheetName: string;
  sheetId: string | null;
  status: RowMatchStatus;
  /** Colaborador efetivo (casado ou escolhido na conciliação). */
  employeeId: string | null;
  employeeName: string | null;
  /** Escolha manual aplicada (ambíguo / não encontrado). */
  chosen: boolean;
  candidates: { id: string; name: string }[];
  cells: ImportCell[];
};

export type ImportResolutions = {
  /** linha da planilha → colaborador escolhido (ambíguo / não encontrado). */
  employeeChoices?: Record<string, string>;
  /** `${employeeId}:${competencyId}` → APPLY (padrão KEEP). */
  conflictDecisions?: Record<string, "APPLY" | "KEEP">;
};

export type ImportChange = {
  employeeId: string;
  competencyId: string;
  from: number;
  to: CompetencyLevel;
  conflict: ConflictReason | null;
};

export type ImportSummary = {
  rows: number;
  matchedRows: number;
  pendingRows: number;
  ignoredRows: number;
  changes: number;
  unchanged: number;
  empty: number;
  invalid: number;
  conflicts: number;
  conflictsToApply: number;
  unknownColumns: number;
};

export type ImportPlan = {
  columns: ImportColumn[];
  rows: ImportRow[];
  changes: ImportChange[];
  summary: ImportSummary;
  /** Erro que impede a importação (ex.: sem coluna Colaborador). */
  fatal: string | null;
};

// ---------------------------------------------------------------------------

export function normalizeImportText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVEL_BY_LABEL = new Map(
  (Object.entries(COMPETENCY_LEVEL_LABELS) as [string, string][]).map(([n, label]) => [normalizeImportText(label), Number(n)]),
);

/** Valor de célula → nível 0..4; "" → null (vazio); inválido → undefined. */
export function parseLevelCell(value: unknown): CompetencyLevel | null | undefined {
  const text = cellText(value);
  if (text === "") return null;
  const asNumber = Number(text.replace(",", "."));
  if (Number.isFinite(asNumber)) return Number.isInteger(asNumber) && isCompetencyLevel(asNumber) ? asNumber : undefined;
  const byLabel = LEVEL_BY_LABEL.get(normalizeImportText(text));
  return byLabel !== undefined && isCompetencyLevel(byLabel) ? byLabel : undefined;
}

export const conflictKey = (employeeId: string, competencyId: string) => `${employeeId}:${competencyId}`;

function emptySummary(): ImportSummary {
  return { rows: 0, matchedRows: 0, pendingRows: 0, ignoredRows: 0, changes: 0, unchanged: 0, empty: 0, invalid: 0, conflicts: 0, conflictsToApply: 0, unknownColumns: 0 };
}

function mapColumns(header: unknown[], ctx: ImportContext): ImportColumn[] {
  const byName = new Map(ctx.competencies.map((c) => [normalizeImportText(c.name), c.id]));
  const seenCompetencies = new Set<string>();
  const columns: ImportColumn[] = [];
  header.slice(0, IMPORT_MAX_COLUMNS).forEach((raw, index) => {
    const text = cellText(raw);
    if (text === "") return;
    const norm = normalizeImportText(text);
    if (norm === normalizeImportText(IMPORT_HEADER_ID)) return columns.push({ index, header: text, kind: "ID", competencyId: null });
    if (norm === normalizeImportText(IMPORT_HEADER_EMPLOYEE) || norm === "nome") {
      return columns.push({ index, header: text, kind: "EMPLOYEE", competencyId: null });
    }
    if (norm === normalizeImportText(IMPORT_HEADER_POSITION)) return columns.push({ index, header: text, kind: "POSITION", competencyId: null });
    const competencyId = byName.get(norm) ?? null;
    if (!competencyId) return columns.push({ index, header: text, kind: "UNKNOWN", competencyId: null });
    if (seenCompetencies.has(competencyId)) return columns.push({ index, header: text, kind: "DUPLICATE", competencyId: null });
    seenCompetencies.add(competencyId);
    columns.push({ index, header: text, kind: "COMPETENCY", competencyId });
  });
  return columns;
}

/**
 * Monta o plano de importação: conciliação, classificação de cada célula e a lista final de
 * alterações já com as resoluções do usuário aplicadas.
 */
export function buildImportPlan(sheet: unknown[][], ctx: ImportContext, resolutions: ImportResolutions = {}): ImportPlan {
  const headerIndex = sheet.findIndex((row) => Array.isArray(row) && row.some((c) => cellText(c) !== ""));
  if (headerIndex < 0) return { columns: [], rows: [], changes: [], summary: emptySummary(), fatal: "A planilha está vazia." };
  const columns = mapColumns(sheet[headerIndex], ctx);
  const nameCol = columns.find((c) => c.kind === "EMPLOYEE");
  if (!nameCol) {
    return { columns, rows: [], changes: [], summary: emptySummary(), fatal: `Coluna "${IMPORT_HEADER_EMPLOYEE}" não encontrada na primeira linha preenchida.` };
  }
  const competencyCols = columns.filter((c) => c.kind === "COMPETENCY");
  if (competencyCols.length === 0) {
    return { columns, rows: [], changes: [], summary: emptySummary(), fatal: "Nenhuma coluna corresponde a uma competência do catálogo." };
  }
  const dataRows = sheet.slice(headerIndex + 1);
  if (dataRows.length > IMPORT_MAX_ROWS) {
    return { columns, rows: [], changes: [], summary: emptySummary(), fatal: `A planilha tem mais de ${IMPORT_MAX_ROWS} linhas.` };
  }
  const idCol = columns.find((c) => c.kind === "ID");

  const employeesById = new Map(ctx.employees.map((e) => [e.id.toLowerCase(), e]));
  const employeesByName = new Map<string, ImportContext["employees"]>();
  for (const e of ctx.employees) {
    const key = normalizeImportText(e.name);
    employeesByName.set(key, [...(employeesByName.get(key) ?? []), e]);
  }
  const levelOf = new Map(ctx.levels.map((l) => [conflictKey(l.employeeId, l.competencyId), l]));
  const choices = resolutions.employeeChoices ?? {};
  const decisions = resolutions.conflictDecisions ?? {};
  const usedEmployees = new Set<string>();
  const rows: ImportRow[] = [];
  const changes: ImportChange[] = [];
  const summary = emptySummary();
  summary.unknownColumns = columns.filter((c) => c.kind === "UNKNOWN" || c.kind === "DUPLICATE").length;

  dataRows.forEach((raw, i) => {
    const values = Array.isArray(raw) ? raw : [];
    if (!values.some((c) => cellText(c) !== "")) return; // linha em branco
    const rowNumber = headerIndex + 2 + i; // 1-based como no Excel
    const sheetName = cellText(values[nameCol.index]);
    const sheetIdRaw = idCol ? cellText(values[idCol.index]) : "";
    const sheetId = UUID_RE.test(sheetIdRaw) ? sheetIdRaw.toLowerCase() : null;
    summary.rows += 1;

    let status: RowMatchStatus;
    let employee: ImportContext["employees"][number] | null = null;
    let candidates: { id: string; name: string }[] = [];
    let chosen = false;
    if (sheetId && employeesById.has(sheetId)) {
      employee = employeesById.get(sheetId)!;
      status = "MATCHED";
    } else if (sheetName === "" && !sheetId) {
      status = "EMPTY_NAME";
    } else {
      const found = employeesByName.get(normalizeImportText(sheetName)) ?? [];
      if (found.length === 1) {
        employee = found[0];
        status = "MATCHED";
      } else if (found.length > 1) {
        status = "AMBIGUOUS";
        candidates = found.map((e) => ({ id: e.id, name: e.name }));
      } else {
        status = "NOT_FOUND";
      }
    }
    const choice = choices[String(rowNumber)];
    if ((status === "AMBIGUOUS" || status === "NOT_FOUND" || status === "EMPTY_NAME") && choice) {
      const picked = employeesById.get(choice.toLowerCase());
      const allowed = status === "AMBIGUOUS" ? candidates.some((c) => c.id === picked?.id) : Boolean(picked);
      if (picked && allowed) {
        employee = picked;
        status = "MATCHED";
        chosen = true;
      }
    }
    if (status === "MATCHED" && employee && !employee.writable) status = "OUT_OF_SCOPE";
    if (status === "MATCHED" && employee && usedEmployees.has(employee.id)) status = "DUPLICATE_ROW";
    if (status === "MATCHED" && employee) usedEmployees.add(employee.id);

    const effective = status === "MATCHED" && employee ? employee : null;
    const cells: ImportCell[] = competencyCols.map((col) => {
      const rawValue = values[col.index];
      const parsed = parseLevelCell(rawValue);
      const current = effective ? levelOf.get(conflictKey(effective.id, col.competencyId!)) : undefined;
      const currentLevel = current?.level ?? 0;
      const base = {
        competencyId: col.competencyId!,
        raw: cellText(rawValue),
        value: parsed ?? null,
        current: currentLevel,
        currentSource: current?.source ?? null,
        conflictReason: null as ConflictReason | null,
      };
      if (parsed === undefined) return { ...base, kind: "INVALID" as const };
      if (parsed === null) return { ...base, kind: "EMPTY" as const };
      if (!effective) return { ...base, kind: "UNCHANGED" as const };
      if (parsed === currentLevel) return { ...base, kind: "UNCHANGED" as const };
      const reason: ConflictReason | null =
        parsed < currentLevel ? "DOWNGRADE" : current?.source === "ASSESSMENT" ? "ASSESSED" : null;
      return { ...base, kind: reason ? ("CONFLICT" as const) : ("CHANGE" as const), conflictReason: reason };
    });

    if (effective) {
      summary.matchedRows += 1;
      for (const cell of cells) {
        if (cell.kind === "EMPTY") summary.empty += 1;
        else if (cell.kind === "INVALID") summary.invalid += 1;
        else if (cell.kind === "UNCHANGED") summary.unchanged += 1;
        else if (cell.kind === "CHANGE" || cell.kind === "CONFLICT") {
          const apply = cell.kind === "CHANGE" || decisions[conflictKey(effective.id, cell.competencyId)] === "APPLY";
          if (cell.kind === "CONFLICT") summary.conflicts += 1;
          if (cell.kind === "CONFLICT" && apply) summary.conflictsToApply += 1;
          if (apply) {
            changes.push({ employeeId: effective.id, competencyId: cell.competencyId, from: cell.current, to: cell.value!, conflict: cell.conflictReason });
          }
        }
      }
    } else if (status === "AMBIGUOUS" || status === "NOT_FOUND" || status === "EMPTY_NAME") {
      summary.pendingRows += 1;
    } else {
      summary.ignoredRows += 1;
    }
    rows.push({
      rowNumber,
      sheetName,
      sheetId,
      status,
      employeeId: employee?.id ?? null,
      employeeName: employee?.name ?? null,
      chosen,
      candidates,
      cells,
    });
  });
  summary.changes = changes.length;
  return { columns, rows, changes, summary, fatal: null };
}

/**
 * Impressão digital do estado + plano: mudou o catálogo, a equipe, os níveis atuais ou as
 * resoluções desde a prévia → a aplicação é recusada (prévia desatualizada).
 */
export function importFingerprintSource(ctx: ImportContext, plan: ImportPlan, fileSha256: string): string {
  const touched = new Set(plan.changes.map((c) => conflictKey(c.employeeId, c.competencyId)));
  const levels = ctx.levels
    .filter((l) => touched.has(conflictKey(l.employeeId, l.competencyId)) || plan.rows.some((r) => r.employeeId === l.employeeId))
    .map((l) => `${l.employeeId}:${l.competencyId}=${l.level}/${l.source}`)
    .sort();
  return JSON.stringify({
    file: fileSha256,
    competencies: ctx.competencies.map((c) => c.id).sort(),
    changes: plan.changes.map((c) => `${c.employeeId}:${c.competencyId}:${c.from}>${c.to}`).sort(),
    levels,
  });
}
