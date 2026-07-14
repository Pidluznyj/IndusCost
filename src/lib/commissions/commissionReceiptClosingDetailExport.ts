export * from "./commissionReceiptClosingDetailExport.shared.js";
export {
  RECEIPT_CLOSING_DETAIL_EXPORT_TITLE,
  RECEIPT_CLOSING_DETAIL_EXPORT_TITLE_PREVIEW,
} from "./commissionReceiptClosingDetailExport.shared.js";
import { buildReceiptClosingDetailExportWorkbook } from "./commissionReceiptClosingDetailExport.shared.js";
import type { ReceiptClosingPagePayload } from "./commissionReceiptClosingApi.shared.js";
import * as XLSX from "xlsx";

export function buildReceiptClosingDetailExportBuffer(payload: ReceiptClosingPagePayload): Buffer {
  const wb = buildReceiptClosingDetailExportWorkbook(payload);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
