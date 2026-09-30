/**
 * Metadados institucionais e de cópia controlada do Relatório Comercial > Clientes.
 * Espelha Pedidos de Venda / POL-COM-001 §23 (documento controlado).
 */

export const CUSTOMER_LIST_REPORT_PRINT_DOCUMENT_TITLE = "COMERCIAL";
export const CUSTOMER_LIST_REPORT_PRINT_DOCUMENT_HIGHLIGHT = "CLIENTES";
export const CUSTOMER_LIST_REPORT_PRINT_SUBTITLE =
  "Relatório da carteira de clientes e contatos comerciais, conforme o filtro da tela";
export const CUSTOMER_LIST_REPORT_PRINT_DATA_SOURCE = "Cadastro Comercial de Clientes (IndusCost)";
export const CUSTOMER_LIST_REPORT_CLASSIFICATION =
  "DOCUMENTO CONTROLADO — USO INTERNO E RESTRITO";
export const CUSTOMER_LIST_REPORT_WATERMARK = "USO INTERNO — NÃO COMPARTILHAR";
export const CUSTOMER_LIST_REPORT_PRINT_FOOTER_NOTE =
  "Documento gerado pelo IndusCost · Comercial > Clientes · cópia controlada";

export const CUSTOMER_LIST_REPORT_PRINT_DISCLAIMER =
  "Este relatório é um DOCUMENTO CONTROLADO, de uso interno e restrito. Contém dados cadastrais, comerciais e de risco de clientes. Não deve ser compartilhado, encaminhado, publicado, copiado para e-mail pessoal, nuvem pessoal, aplicativos de mensagem ou terceiros sem autorização expressa da Diretoria. A posse desta cópia não autoriza divulgação. Vazamento, reprodução ou uso indevido poderá ensejar medidas administrativas, contratuais e legais. A identificação do emitente, data/hora, código da cópia e SHA-256 abaixo constituem evidência da emissão desta cópia.";

export const CUSTOMER_LIST_REPORT_PRINT_NOTICE = [
  "CONFIDENCIALIDADE E RESTRIÇÃO DE USO",
  "Este documento contém informações internas de natureza comercial, cadastral e estratégica.",
  "A presente cópia destina-se exclusivamente ao uso autorizado no exercício das atividades profissionais do destinatário.",
  "É vedado reproduzir, distribuir, encaminhar, fotografar, publicar ou disponibilizar este relatório fora da empresa sem autorização expressa.",
  "A posse desta cópia não implica autorização para divulgação.",
  "A versão eletrônica vigente mantida no IndusCost constitui a referência oficial do cadastro.",
] as const;

export type CustomerListReportCopyControl = {
  copyCode: string;
  fingerprint: string;
  classification: string;
  emitterName: string;
  emitterEmail: string;
  emitterUserId: string;
};

export function serializeCustomerListReportFingerprintSource(input: {
  generatedAt: string;
  emitterUserId: string;
  emitterEmail: string;
  filters: Array<{ label: string; value: string }>;
  rowCount: number;
  firstTaxId: string;
  lastTaxId: string;
}): string {
  return [
    input.generatedAt,
    input.emitterUserId.trim().toLowerCase(),
    input.emitterEmail.trim().toLowerCase(),
    input.filters.map((row) => `${row.label}=${row.value}`).join("|"),
    String(input.rowCount),
    input.firstTaxId.trim(),
    input.lastTaxId.trim(),
  ].join("\n");
}

export function buildCustomerListReportCopyCode(stamp: Date, fingerprintHex: string): string {
  const y = stamp.getFullYear();
  const m = String(stamp.getMonth() + 1).padStart(2, "0");
  const d = String(stamp.getDate()).padStart(2, "0");
  const token = fingerprintHex.replace(/[^a-fA-F0-9]/g, "").slice(0, 8).toUpperCase() || "00000000";
  return `CLT-${y}${m}${d}-${token}`;
}
