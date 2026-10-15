import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import {
  getProjectIntakeFormFullPath,
  getProjectIntakeFormPath,
} from "@/src/lib/projectsIntakeForm";
import {
  PROJECT_INTAKE_FULL_BUTTON_LABEL,
  PROJECT_INTAKE_QUICK_BUTTON_LABEL,
} from "@/src/lib/projectsIntakeQuickForm";
import {
  downloadProjectIntakeSpreadsheet,
  PROJECT_INTAKE_SPREADSHEET_BUTTON_LABEL,
} from "@/src/lib/projectsIntakeSpreadsheet";
import { downloadProjectSpreadsheetPreview } from "@/src/components/projects/documents/projectSpreadsheetDownload";

type Props = {
  projectId?: string | null;
  layout?: "toolbar" | "documents";
};

const secondaryBtn =
  "inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60";
const primaryBtn =
  "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90";

export function ProjectIntakeActions({ projectId, layout = "toolbar" }: Props) {
  const quickPath = projectId ? getProjectIntakeFormPath(projectId) : "/projects/intake-form/blank";
  const fullPath = projectId ? getProjectIntakeFormFullPath(projectId) : "/projects/intake-form/blank/full";
  const [downloading, setDownloading] = useState(false);
  const [spreadsheetError, setSpreadsheetError] = useState<string | null>(null);

  /** Com projeto: dados reais do projeto (prévia). Sem projeto: modelo em branco + aba de exemplo. */
  const handleSpreadsheet = async () => {
    setSpreadsheetError(null);
    if (!projectId) {
      downloadProjectIntakeSpreadsheet();
      return;
    }
    setDownloading(true);
    try {
      await downloadProjectSpreadsheetPreview(projectId);
    } catch (e) {
      setSpreadsheetError(e instanceof Error ? e.message : "Não foi possível gerar a planilha do projeto.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={layout === "documents" ? "flex flex-col items-end gap-1" : "flex flex-col gap-1"}>
      <div className="flex flex-wrap gap-2">
        <Link to={quickPath} className={primaryBtn}>
          <ClipboardList className="h-4 w-4" />
          {PROJECT_INTAKE_QUICK_BUTTON_LABEL}
        </Link>
        <Link to={fullPath} className={secondaryBtn}>
          <FileText className="h-4 w-4" />
          {PROJECT_INTAKE_FULL_BUTTON_LABEL}
        </Link>
        <button
          type="button"
          onClick={() => void handleSpreadsheet()}
          disabled={downloading}
          className={secondaryBtn}
          data-testid="project-spreadsheet-download"
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          {PROJECT_INTAKE_SPREADSHEET_BUTTON_LABEL}
        </button>
      </div>
      {spreadsheetError ? <p className="text-xs text-destructive">{spreadsheetError}</p> : null}
    </div>
  );
}
