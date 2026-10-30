/**
 * Ficha completa do colaborador: documento corrido (tela e PDF) montado a partir das guias da ficha funcional.
 * Browser-safe.
 *
 * Valor de remuneração NUNCA entra no modelo: salário, reajuste (valor e percentual), benefício e encargo saem como
 * EMPLOYEE_SHEET_MASK para todos, mesmo para quem pode vê-los na guia Remuneração. O construtor não lê os campos
 * numéricos, e os textos livres passam por máscara.
 * Observações restritas e administrativas ficam fora do documento impresso.
 */

import { EPI_DELIVERY_STATUS_LABELS } from "./epi/epiRules.js";
import { HR_ABSENCE_STATUS_LABELS, HR_ABSENCE_TYPE_LABELS, HR_NOTE_CATEGORY_LABELS } from "./peopleProfileTypes.js";

export const EMPLOYEE_SHEET_MASK = "XXXXXXXX";

const COMPENSATION_KEYWORD =
  /\b(sal[aá]ri\w*|remunera\w*|vencimento\w*|reajuste\w*|aumento\w*|bonifica\w*|b[oô]nus|comiss\w*|benef[ií]cio\w*|gratifica\w*|ajuda de custo)\b([^\d\n]{0,25})\d[\d.,]*/gi;

/** Valores monetários e percentuais em texto livre. Número solto sem contexto salarial segue como está. */
export function maskSensitiveValuesInText(text: string): string {
  return text
    .replace(/(?:R\$|BRL)\s*-?\s*\d[\d.,]*/gi, EMPLOYEE_SHEET_MASK)
    .replace(/[+-]?\d+(?:[.,]\d+)?\s*%/g, EMPLOYEE_SHEET_MASK)
    .replace(/\b\d{1,3}(?:\.\d{3})*,\d{1,2}\b/g, EMPLOYEE_SHEET_MASK)
    // Lookahead: CPF, CNPJ e CEP continuam inteiros.
    .replace(/\b\d{1,3}(?:\.\d{3})+\b(?![.\-/]\d)/g, EMPLOYEE_SHEET_MASK)
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:mil|reais)\b/gi, EMPLOYEE_SHEET_MASK)
    .replace(COMPENSATION_KEYWORD, (_match, word: string, gap: string) => `${word}${gap}${EMPLOYEE_SHEET_MASK}`);
}

/** Texto ligado a remuneração: qualquer número sai mascarado. */
function maskAllNumbers(text: string): string {
  return maskSensitiveValuesInText(text).replace(/\d[\d.,]*/g, EMPLOYEE_SHEET_MASK);
}

export type EmployeeSheetField = { label: string; value: string; span?: 1 | 2 | 3 | 4; masked?: boolean };
export type EmployeeSheetTable = { columns: string[]; rows: string[][] };
export type EmployeeSheetSection = {
  id: string;
  title: string;
  /** Sem permissão ou falha de leitura: a ficha avisa, não finge que está vazia. */
  unavailable?: string;
  fields?: EmployeeSheetField[];
  tables?: Array<EmployeeSheetTable & { title?: string; empty: string }>;
};

export type EmployeeRecordSheet = {
  identity: {
    fullName: string;
    socialName: string | null;
    registrationId: string;
    statusLabel: string;
    photoUrl: string | null;
    roleName: string | null;
    department: string | null;
  };
  sections: EmployeeSheetSection[];
};

/** `undefined`: sem permissão. `{ error }`: leitura falhou. */
export type EmployeeSheetSource<T> = T | { error: string } | undefined;

export type EmployeeRecordSheetInput = {
  summary: {
    identity: {
      fullName: string;
      socialName: string | null;
      registrationId: string;
      statusLabel: string;
      photoUrl: string | null;
      roleName: string | null;
      department: string | null;
      costCenterLabel: string | null;
      managerName: string | null;
      contractType: string | null;
      workSchedule: string | null;
      corporateEmail: string | null;
      classification: string | null;
    };
    kpis: { admissionDate: string | null; tenureLabel: string | null };
  };
  personal?: EmployeeSheetSource<Record<string, unknown>>;
  emergency?: EmployeeSheetSource<{ redacted?: boolean; contacts?: Array<Record<string, unknown>> }>;
  professional?: EmployeeSheetSource<Record<string, unknown>>;
  career?: EmployeeSheetSource<{ items?: Array<Record<string, unknown>> }>;
  compensation?: EmployeeSheetSource<{ items?: Array<Record<string, unknown>> }>;
  benefits?: EmployeeSheetSource<{ items?: Array<Record<string, unknown>> }>;
  absences?: EmployeeSheetSource<{ items?: Array<Record<string, unknown>> }>;
  epi?: EmployeeSheetSource<{ sizes?: Record<string, unknown>; events?: Array<Record<string, unknown>> }>;
  documents?: EmployeeSheetSource<{ items?: Array<Record<string, unknown>> }>;
  certificates?: EmployeeSheetSource<{ items?: Array<Record<string, unknown>> }>;
  competencies?: EmployeeSheetSource<{ associated?: Array<Record<string, unknown>> }>;
  evaluations?: EmployeeSheetSource<{ items?: Array<Record<string, unknown>> }>;
  history?: EmployeeSheetSource<{ items?: Array<Record<string, unknown>> }>;
  notes?: EmployeeSheetSource<{ notes?: Array<Record<string, unknown>> }>;
};

const EMPTY = "—";

function text(value: unknown): string {
  if (value == null) return EMPTY;
  const out = String(value).trim();
  return out ? maskSensitiveValuesInText(out) : EMPTY;
}

function labelOf(labels: Record<string, string>, value: unknown): string {
  return text(labels[String(value)] ?? value);
}

export function formatSheetDate(value: unknown): string {
  if (!value) return EMPTY;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return EMPTY;
  return parsed.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function failure(source: unknown): string | null {
  if (source === undefined) return "Sem permissão para ver esta seção.";
  if (source && typeof source === "object" && "error" in source) {
    return `Não foi possível carregar esta seção: ${String((source as { error: unknown }).error)}`;
  }
  return null;
}

function section(
  id: string,
  title: string,
  source: unknown,
  build: () => Pick<EmployeeSheetSection, "fields" | "tables">
): EmployeeSheetSection {
  const unavailable = failure(source);
  if (unavailable) return { id, title, unavailable };
  if ((source as { redacted?: boolean } | null)?.redacted === true) {
    return { id, title, unavailable: "Informação restrita." };
  }
  return { id, title, ...build() };
}

function rowsOf(source: unknown, key = "items"): Array<Record<string, unknown>> {
  const list = (source as Record<string, unknown> | null)?.[key];
  return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
}

function period(start: unknown, end: unknown): string {
  return end ? `${formatSheetDate(start)} a ${formatSheetDate(end)}` : `Desde ${formatSheetDate(start)}`;
}

export function buildEmployeeRecordSheet(input: EmployeeRecordSheetInput): EmployeeRecordSheet {
  const { identity, kpis } = input.summary;
  const sections: EmployeeSheetSection[] = [];

  sections.push(
    section("personal", "Dados pessoais", input.personal, () => {
      const data = input.personal as Record<string, unknown>;
      return {
        fields: [
          { label: "Nome", value: text(data.fullName), span: 2 },
          { label: "Nome social", value: text(data.socialName), span: 2 },
          { label: "CPF", value: text(data.cpf) },
          { label: "RG", value: text(data.rg) },
          { label: "Nascimento", value: formatSheetDate(data.birthDate) },
          { label: "Estado civil", value: text(data.maritalStatus) },
          { label: "Telefone", value: text(data.phone) },
          { label: "E-mail pessoal", value: text(data.personalEmail), span: 3 },
          { label: "Endereço", value: text(data.address), span: 4 },
          { label: "Cidade", value: text(data.city), span: 2 },
          { label: "UF", value: text(data.state) },
          { label: "CEP", value: text(data.zipCode) },
        ],
      };
    })
  );

  sections.push(
    section("emergency", "Contatos de emergência", input.emergency, () => ({
      tables: [
        {
          columns: ["Nome", "Parentesco", "Telefone", "Telefone alternativo"],
          rows: rowsOf(input.emergency, "contacts").map((row) => [
            text(row.name),
            text(row.relationship),
            text(row.phone),
            text(row.alternatePhone),
          ]),
          empty: "Nenhum contato de emergência informado.",
        },
      ],
    }))
  );

  sections.push(
    section("professional", "Vínculo e contrato", input.professional, () => {
      const data = input.professional as Record<string, unknown>;
      return {
        fields: [
          { label: "Cargo", value: text(data.roleName), span: 2 },
          { label: "Departamento", value: text(data.department), span: 2 },
          { label: "Centro de custo", value: text(data.costCenterLabel), span: 2 },
          { label: "Gestão", value: text(data.managerName), span: 2 },
          { label: "Tipo de vínculo", value: text(data.contractType) },
          { label: "Jornada", value: text(data.workSchedule) },
          { label: "Admissão", value: formatSheetDate(data.admissionDate) },
          { label: "Tempo de casa", value: text(kpis.tenureLabel) },
          { label: "Situação", value: text(data.statusLabel) },
          { label: "Data de demissão", value: formatSheetDate(data.terminationDate) },
          { label: "Classificação", value: text(data.classification) },
          { label: "E-mail corporativo", value: text(data.corporateEmail) },
          { label: "Observações profissionais", value: text(data.professionalNotes), span: 4 },
        ],
      };
    })
  );

  sections.push(
    section("career", "Carreira", input.career, () => ({
      tables: [
        {
          columns: ["Data", "Evento", "Descrição", "Motivo"],
          rows: rowsOf(input.career).map((row) => [
            formatSheetDate(row.effectiveDate),
            text(row.eventLabel),
            text(row.summary),
            text(row.reason),
          ]),
          empty: "Nenhum evento de carreira registrado.",
        },
      ],
    }))
  );

  sections.push(
    section("compensation", "Remuneração", input.compensation, () => ({
      fields: [{ label: "Salário atual", value: EMPLOYEE_SHEET_MASK, span: 4, masked: true }],
      tables: [
        {
          title: "Histórico de reajustes",
          columns: ["Data", "Tipo", "Percentual", "Valor anterior", "Valor novo", "Motivo"],
          rows: rowsOf(input.compensation).map((row) => [
            formatSheetDate(row.effectiveDate),
            text(row.typeLabel ?? row.type),
            EMPLOYEE_SHEET_MASK,
            EMPLOYEE_SHEET_MASK,
            EMPLOYEE_SHEET_MASK,
            row.reason ? maskAllNumbers(String(row.reason)) : EMPTY,
          ]),
          empty: "Nenhum reajuste registrado.",
        },
      ],
    }))
  );

  sections.push(
    section("benefits", "Encargos e benefícios", input.benefits, () => ({
      tables: [
        {
          columns: ["Verba", "Tipo", "Vigência", "Valor"],
          rows: rowsOf(input.benefits).map((row) => [
            text(row.name),
            text(row.typeLabel),
            row.startDate ? period(row.startDate, row.endDate) : "Cadastro oficial",
            EMPLOYEE_SHEET_MASK,
          ]),
          empty: "Nenhuma verba registrada.",
        },
      ],
    }))
  );

  sections.push(
    section("absences", "Férias e afastamentos", input.absences, () => ({
      tables: [
        {
          columns: ["Período", "Tipo", "Situação", "Retorno", "Motivo"],
          rows: rowsOf(input.absences).map((row) => [
            period(row.startDate, row.endDate),
            labelOf(HR_ABSENCE_TYPE_LABELS, row.type),
            labelOf(HR_ABSENCE_STATUS_LABELS, row.status),
            formatSheetDate(row.actualReturn ?? row.expectedReturn),
            text(row.reason),
          ]),
          empty: "Nenhum registro de férias ou afastamento.",
        },
      ],
    }))
  );

  sections.push(
    section("epi", "EPI e uniformes", input.epi, () => {
      const data = input.epi as { sizes?: Record<string, unknown>; events?: Array<Record<string, unknown>> };
      const sizes = data.sizes ?? {};
      const deliveries = (data.events ?? []).flatMap((event) =>
        (Array.isArray(event.items) ? (event.items as Array<Record<string, unknown>>) : []).map((item) => [
          formatSheetDate(item.deliveredAt ?? event.deliveredAt),
          text(item.item),
          text(item.itemCaNumber),
          text(item.quantity),
          text(item.size),
          labelOf(EPI_DELIVERY_STATUS_LABELS, item.status),
        ])
      );
      return {
        fields: [
          { label: "Camiseta", value: text(sizes.shirtSize) },
          { label: "Calça", value: text(sizes.pantsSize) },
          { label: "Jaqueta", value: text(sizes.jacketSize) },
          { label: "Luva", value: text(sizes.gloveSize) },
          { label: "Calçado", value: text(sizes.shoeSize) },
          { label: "Observações", value: text(sizes.epiNotes), span: 3 },
        ],
        tables: [
          {
            title: "Entregas",
            columns: ["Data", "Item", "CA", "Qtd.", "Tamanho", "Situação"],
            rows: deliveries,
            empty: "Nenhuma entrega registrada.",
          },
        ],
      };
    })
  );

  sections.push(
    section("documents", "Documentos", input.documents, () => ({
      tables: [
        {
          columns: ["Documento", "Tipo", "Emissão", "Validade"],
          rows: rowsOf(input.documents).map((row) => [
            text(row.displayName),
            text(row.documentType),
            formatSheetDate(row.issuedAt ?? row.createdAt),
            formatSheetDate(row.expiresAt),
          ]),
          empty: "Nenhum documento anexado.",
        },
      ],
    }))
  );

  sections.push(
    section("certificates", "Certificados", input.certificates, () => ({
      tables: [
        {
          columns: ["Certificado", "Emissor", "Conclusão", "Validade"],
          rows: rowsOf(input.certificates).map((row) => [
            text(row.title),
            text(row.issuer),
            formatSheetDate(row.completedOn),
            formatSheetDate(row.expiresOn),
          ]),
          empty: "Nenhum certificado registrado.",
        },
      ],
    }))
  );

  sections.push(
    section("competencies", "Competências", input.competencies, () => ({
      tables: [
        {
          columns: ["Competência", "Categoria", "Nível atual"],
          rows: rowsOf(input.competencies, "associated").map((row) => [
            text(row.competencyName),
            text(row.category),
            text(row.currentLevel),
          ]),
          empty: "Nenhuma competência associada.",
        },
      ],
    }))
  );

  sections.push(
    section("evaluations", "Avaliações", input.evaluations, () => ({
      tables: [
        {
          columns: ["Avaliação", "Situação", "Data", "Avaliador", "Média", "Recomendação"],
          rows: rowsOf(input.evaluations).map((row) => [
            text(row.shortLabel ?? row.typeLabel),
            text(row.statusLabel),
            formatSheetDate(row.evaluationDate ?? row.dueDate),
            text(row.evaluatorName),
            text(row.averageLabel),
            text(row.recommendationLabel),
          ]),
          empty: "Nenhuma avaliação registrada.",
        },
      ],
    }))
  );

  sections.push(
    section("history", "Histórico funcional", input.history, () => ({
      tables: [
        {
          columns: ["Data", "Evento", "Descrição"],
          rows: rowsOf(input.history).map((row) => [
            formatSheetDate(row.effectiveDate),
            text(row.eventLabel),
            historyDescription(row),
          ]),
          empty: "Nenhum evento registrado.",
        },
      ],
    }))
  );

  sections.push(
    section("notes", "Observações", input.notes, () => ({
      tables: [
        {
          columns: ["Data", "Categoria", "Observação", "Registrado por"],
          rows: rowsOf(input.notes, "notes")
            .filter((row) => row.category !== "RESTRITA")
            .map((row) => [
              formatSheetDate(row.createdAt),
              labelOf(HR_NOTE_CATEGORY_LABELS, row.category),
              text(row.body),
              text(row.createdByName),
            ]),
          empty: "Nenhuma observação registrada.",
        },
      ],
    }))
  );

  return {
    identity: {
      fullName: identity.fullName,
      socialName: identity.socialName,
      registrationId: identity.registrationId,
      statusLabel: identity.statusLabel,
      photoUrl: identity.photoUrl,
      roleName: identity.roleName,
      department: identity.department,
    },
    // Módulo de Competências desligado ou sem acesso: a seção não existe, não é "sem permissão".
    sections: sections.filter((row) => row.id !== "competencies" || input.competencies !== undefined),
  };
}

/** O resumo do reajuste traz valores e o de observação traz o texto (pode ser restrito): nenhum dos dois é copiado. */
function historyDescription(row: Record<string, unknown>): string {
  if (row.eventType === "COMPENSATION_ADJUSTMENT") return EMPLOYEE_SHEET_MASK;
  if (row.eventType === "NOTE_ADDED") return EMPTY;
  return text(row.summary);
}
