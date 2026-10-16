/**
 * Ficha de entrega de EPI/uniforme — regras puras (identificador, referência, situação documental, arquivo).
 *
 * A ficha pertence ao EVENTO de entrega (uma ocasião com um ou mais itens), não ao item nem ao colaborador.
 * Identificador (padrão dos documentos emitidos do IndusCost, ver ProjectIssuedDocument / referenceCode):
 * - formCode  FE-{ano}-{00001}: a ficha do evento (sequência anual, única por evento);
 * - documentNumber FE-{ano}-{00001}-R{01}: cada revisão emitida (único no banco).
 * QR opaco no padrão da avaliação de experiência: INDUSCOST-HR-EPI:{documentNumber}:{formId}.
 * Reconhecimento: o IndusCost não tem OCR nem leitura de QR em PDF digitalizado. Há (1) o número informado
 * (digitado ou lido por leitor de QR), (2) o nome do arquivo e (3) o BarcodeDetector nativo do navegador
 * em imagens (mesma capability do coletor de inventário). Tudo é conferido no servidor.
 */

export const EPI_FORM_TITLE = "FICHA DE ENTREGA DE EPI / UNIFORME";
export const EPI_FORM_DECLARATION =
  "Declaro que recebi os equipamentos e/ou uniformes relacionados neste documento, nas quantidades indicadas, nesta data.";
export const EPI_FORM_QR_PREFIX = "INDUSCOST-HR-EPI";
export const EPI_RECEIPT_DOCUMENT_TYPE = "EPI_DELIVERY_RECEIPT";
export const EPI_RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

export function formatEpiFormCode(year: number, sequence: number): string {
  return `FE-${year}-${String(sequence).padStart(5, "0")}`;
}

export function formatEpiFormDocumentNumber(formCode: string, revision: number): string {
  return `${formCode}-R${String(revision).padStart(2, "0")}`;
}

export function epiFormQrPayload(documentNumber: string, formId: string): string {
  return `${EPI_FORM_QR_PREFIX}:${documentNumber}:${formId}`;
}

export type EpiFormReference = {
  formCode: string;
  /** null = só o código da ficha (vale a revisão vigente). */
  revision: number | null;
  /** Presente quando veio do QR: precisa bater com o número. */
  formId: string | null;
};

const CODE_RE = /^(FE-\d{4}-\d{5,})(?:-R(\d{2,}))?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Aceita o número impresso (FE-2026-00001-R01), só o código (FE-2026-00001) ou o texto do QR.
 * Qualquer outra coisa é inválida: nada de busca aproximada (a associação precisa ser inequívoca).
 */
export function parseEpiFormReference(raw: unknown): EpiFormReference | null {
  if (typeof raw !== "string") return null;
  let text = raw.trim().replace(/\s+/g, "");
  if (!text || text.length > 200) return null;
  let formId: string | null = null;
  if (text.toUpperCase().startsWith(`${EPI_FORM_QR_PREFIX}:`)) {
    const parts = text.split(":");
    if (parts.length !== 3 || !UUID_RE.test(parts[2])) return null;
    formId = parts[2].toLowerCase();
    text = parts[1];
    if (!/-R\d{2,}$/i.test(text)) return null;
  }
  const m = CODE_RE.exec(text.toUpperCase());
  if (!m) return null;
  return { formCode: m[1], revision: m[2] ? Number(m[2]) : null, formId };
}

/**
 * Número da ficha no NOME do arquivo (ex.: "FE-2026-00012-R01 assinada.pdf"). Só aceita exatamente
 * um número distinto: nenhum ou vários → null (vai para revisão manual).
 */
export function epiFormReferenceFromFileName(fileName: string): string | null {
  const found = new Set((fileName.toUpperCase().match(/FE-\d{4}-\d{5,}-R\d{2,}/g) ?? []).map((s) => s));
  return found.size === 1 ? [...found][0] : null;
}

export const EPI_DOCUMENT_STATUSES = ["NOT_ISSUED", "AWAITING_SIGNATURE", "ATTACHED", "VALIDATED"] as const;
export type EpiDocumentStatus = (typeof EPI_DOCUMENT_STATUSES)[number];
export const EPI_DOCUMENT_STATUS_LABELS: Record<EpiDocumentStatus, string> = {
  NOT_ISSUED: "Ficha não emitida",
  AWAITING_SIGNATURE: "Aguardando assinatura",
  ATTACHED: "Documento anexado",
  VALIDATED: "Validado",
};

export type EpiDocumentState = {
  status: EpiDocumentStatus;
  /** Comprovante vigente é de uma revisão anterior da ficha (conteúdo mudou depois). */
  outdatedReceipt: boolean;
  /** Comprovante vigente foi conferido e rejeitado (precisa anexar outro). */
  rejected: boolean;
};

/**
 * Situação documental do evento. Emitir a ficha não é comprovante; anexar não é validar;
 * comprovante rejeitado ou de revisão anterior volta a "aguardando", sinalizado.
 * Independente de vencimento/substituição dos itens.
 */
export function deriveEpiDocumentStatus(input: {
  activeFormId: string | null;
  currentReceipt: { formId: string | null; validationResult: string | null } | null;
}): EpiDocumentState {
  const r = input.currentReceipt;
  if (r) {
    const outdated = Boolean(input.activeFormId && r.formId && r.formId !== input.activeFormId);
    if (outdated) return { status: "AWAITING_SIGNATURE", outdatedReceipt: true, rejected: false };
    if (r.validationResult === "REJECTED") return { status: "AWAITING_SIGNATURE", outdatedReceipt: false, rejected: true };
    return { status: r.validationResult === "APPROVED" ? "VALIDATED" : "ATTACHED", outdatedReceipt: false, rejected: false };
  }
  return { status: input.activeFormId ? "AWAITING_SIGNATURE" : "NOT_ISSUED", outdatedReceipt: false, rejected: false };
}

export type EpiReceiptFileCheck = { ok: true; kind: "pdf" | "jpeg" | "png" } | { ok: false; code: string; message: string };

/**
 * Comprovante digitalizado: PDF, JPG ou PNG, conferidos pelo CONTEÚDO (assinatura de bytes), não só pelo nome.
 * Arquivo vazio, maior que o limite, de outro tipo ou truncado (sem o fim do formato) é recusado.
 */
export function checkEpiReceiptFile(file: { buffer: Uint8Array; originalName: string; mimeType: string | null }): EpiReceiptFileCheck {
  const b = file.buffer;
  if (!b || b.length === 0) return { ok: false, code: "FILE_EMPTY", message: "O arquivo está vazio." };
  if (b.length > EPI_RECEIPT_MAX_BYTES) return { ok: false, code: "FILE_TOO_LARGE", message: "Arquivo acima de 10 MB." };
  const ext = file.originalName.toLowerCase().split(".").pop() ?? "";
  const startsWith = (sig: number[]) => sig.every((v, i) => b[i] === v);
  let kind: "pdf" | "jpeg" | "png" | null = null;
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) kind = "pdf";
  else if (startsWith([0xff, 0xd8, 0xff])) kind = "jpeg";
  else if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) kind = "png";
  if (!kind) return { ok: false, code: "FILE_TYPE", message: "Envie PDF, JPG ou PNG (o conteúdo do arquivo não é de nenhum desses formatos)." };
  const extOk = kind === "pdf" ? ext === "pdf" : kind === "jpeg" ? ext === "jpg" || ext === "jpeg" : ext === "png";
  if (!extOk) return { ok: false, code: "FILE_TYPE", message: "A extensão do arquivo não corresponde ao conteúdo." };
  const mime = (file.mimeType ?? "").toLowerCase().split(";")[0].trim();
  const mimeOk =
    !mime ||
    mime === "application/octet-stream" ||
    (kind === "pdf" && mime === "application/pdf") ||
    (kind === "jpeg" && (mime === "image/jpeg" || mime === "image/jpg")) ||
    (kind === "png" && mime === "image/png");
  if (!mimeOk) return { ok: false, code: "FILE_TYPE", message: "O tipo informado do arquivo não corresponde ao conteúdo." };
  // Truncado / corrompido: o fim estrutural do formato precisa estar presente.
  const tail = String.fromCharCode(...b.subarray(Math.max(0, b.length - 2048)));
  const intact =
    kind === "pdf"
      ? tail.includes("%%EOF")
      : kind === "jpeg"
        ? b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9
        : tail.includes("IEND");
  if (!intact) return { ok: false, code: "FILE_CORRUPTED", message: "O arquivo parece incompleto ou corrompido. Digitalize novamente." };
  return { ok: true, kind };
}

export type EpiFormItem = {
  deliveryId: string;
  itemCode: string | null;
  item: string;
  itemType: string | null;
  caNumber: string | null;
  unit: string | null;
  quantity: number;
  size: string | null;
  replacementDays: number | null;
  replacementDueDate: string | null;
};

export type EpiFormBody = {
  employee: {
    id: string;
    name: string;
    registration: string;
    department: string | null;
    role: string | null;
  };
  event: {
    id: string;
    deliveredOn: string;
    responsibleName: string | null;
    notes: string | null;
  };
  items: EpiFormItem[];
  declaration: string;
};

export type EpiFormHeader = {
  formId: string;
  formCode: string;
  revision: number;
  documentNumber: string;
  previousDocumentNumber: string | null;
  issuedAt: string;
  issuedByName: string | null;
  issuer: {
    legalName: string | null;
    document: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    logoDataUrl: string | null;
  };
};

export type EpiFormPayload = { kind: "EPI_DELIVERY_FORM"; version: 2; header: EpiFormHeader; body: EpiFormBody };
