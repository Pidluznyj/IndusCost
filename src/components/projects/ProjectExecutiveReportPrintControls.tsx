import React from "react";
import { ArrowLeft, Printer } from "lucide-react";

type Props = {
  onBack: () => void;
  onPrint: () => void;
  printDisabled?: boolean;
  backLabel?: string;
};

export function ProjectExecutiveReportPrintControls({
  onBack,
  onPrint,
  printDisabled = false,
  backLabel = "Voltar ao projeto",
}: Props) {
  return (
    <div className="project-executive-report-print-no-print mx-auto mb-4 flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-3 print:hidden">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-accent"
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </button>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" disabled className="rounded border-border" />
          Incluir anexo técnico
          <span className="text-xs">(próxima versão)</span>
        </label>
        <button
          type="button"
          onClick={onPrint}
          disabled={printDisabled}
          title="Para PDF sem cabeçalho/rodapé do navegador, desative “Cabeçalhos e rodapés” nas opções de impressão."
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
        >
          <Printer className="h-4 w-4" />
          Imprimir / Salvar PDF
        </button>
      </div>
    </div>
  );
}
