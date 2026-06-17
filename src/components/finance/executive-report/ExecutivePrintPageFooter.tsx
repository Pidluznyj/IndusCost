import React from "react";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";

export function ExecutivePrintPageFooter({
  pageNumber,
  totalPages,
  generatedAt,
}: {
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
}) {
  return (
    <div className="executive-print-page-footer" aria-hidden="true">
      <span>Fonte: IndusCost + Nomus — dados consolidados</span>
      <span>
        Página {pageNumber} de {totalPages}
      </span>
      <span>Gerado em {formatFinanceDateTime(generatedAt)}</span>
    </div>
  );
}
