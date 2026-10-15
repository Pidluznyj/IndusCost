import { fetchJsonOk } from "@/src/lib/http";
import type { ProjectDocumentEnvelope } from "@/src/lib/projectsDocumentHeader";
import {
  buildProjectSpreadsheetFilename,
  buildProjectSpreadsheetWorkbookFromData,
  downloadWorkbook,
  type ProjectSpreadsheetData,
} from "@/src/lib/projectsIntakeSpreadsheet";

function downloadEnvelope(envelope: ProjectDocumentEnvelope<ProjectSpreadsheetData>): void {
  downloadWorkbook(
    buildProjectSpreadsheetWorkbookFromData(envelope.body, envelope.header),
    buildProjectSpreadsheetFilename(envelope.header),
  );
}

/** Planilha com os dados reais atuais do projeto, marcada como PRÉVIA (sem número de emissão). */
export async function downloadProjectSpreadsheetPreview(projectId: string): Promise<void> {
  const preview = await fetchJsonOk<{ envelope: ProjectDocumentEnvelope<ProjectSpreadsheetData> }>(
    `/api/projects/${projectId}/documents/planilha/preview`,
  );
  downloadEnvelope(preview.envelope);
}

/** Planilha de uma emissão: reconstruída exatamente do conteúdo congelado. */
export async function downloadIssuedProjectSpreadsheet(projectId: string, issuedId: string): Promise<void> {
  const doc = await fetchJsonOk<{ envelope: ProjectDocumentEnvelope<ProjectSpreadsheetData> }>(
    `/api/projects/${projectId}/documents/issued/${issuedId}`,
  );
  downloadEnvelope(doc.envelope);
}
