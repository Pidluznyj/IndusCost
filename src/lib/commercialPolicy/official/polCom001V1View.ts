/** Constantes de capa usadas na tela. Sem Node e sem hash. */
import { officialPolicyPlainText } from "./polCom001V1Document.js";

export const POL_COM_001_CODE = "POL-COM-001";
export const POL_COM_001_VERSION_LABEL = "1.0";
export const POL_COM_001_TITLE = "POLÍTICA COMERCIAL E DE COMISSIONAMENTO";
export const POL_COM_001_CLASSIFICATION = "POLÍTICA OFICIAL — USO INTERNO E RESTRITO";
export const POL_COM_001_AREA = "Comercial / Administração";
export const POL_COM_001_APPROVER = "Diretoria";
export const POL_COM_001_COMPANY = "Koppetel Comercio de Plásticos LTDA";
export const POL_COM_001_CNPJ = "14.055.501/0001-80";

export function isOfficialCommercialPolicyContent(content: string): boolean {
  return content === officialPolicyPlainText();
}
