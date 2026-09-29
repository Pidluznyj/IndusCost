/** Constantes de capa usadas na tela. Sem Node e sem hash. */
import { POL_COM_001_CHAPTERS } from "./polCom001V1Document.js";
import { serializePolicyChapters } from "../policyDocumentFormat.js";

export const POL_COM_001_CODE = "POL-COM-001";
export const POL_COM_001_VERSION_LABEL = "1.0";
export const POL_COM_001_TITLE = "POLÍTICA COMERCIAL E DE COMISSIONAMENTO";
export const POL_COM_001_CLASSIFICATION = "POLÍTICA OFICIAL — USO INTERNO E RESTRITO";
export const POL_COM_001_AREA = "Comercial / Administração";
export const POL_COM_001_APPROVER = "Diretoria";
export const POL_COM_001_COMPANY = "Koppetel Comercio de Plásticos LTDA";
export const POL_COM_001_CNPJ = "14.055.501/0001-80";

let officialMarkup: string | null = null;

/** Conteúdo oficial gravado na versão: marcação estruturada dos 33 capítulos. */
export function officialCommercialPolicyContent(): string {
  officialMarkup ??= serializePolicyChapters(POL_COM_001_CHAPTERS);
  return officialMarkup;
}

export function isOfficialCommercialPolicyContent(content: string): boolean {
  return content === officialCommercialPolicyContent();
}

/** Versões editadas a partir da POL-COM-001 continuam sujeitas à auditoria documento × sistema. */
export function mentionsCommercialPolicyCode(content: string): boolean {
  return content.includes(POL_COM_001_CODE);
}
