import React, { useMemo } from "react";
import { Printer } from "lucide-react";
import { EmployeeRecordSheetDocument } from "./EmployeeRecordSheetDocument";
import { ProfileState } from "./profileUi";
import { useEmployeeRecordSheet } from "./useEmployeeRecordSheet";

export function PeopleRecordSheetTab({ employeeId }: { employeeId: string }) {
  const { sheet, loading, error } = useEmployeeRecordSheet(employeeId);
  const issuedAt = useMemo(() => new Date(), [sheet]);
  if (loading) return <ProfileState kind="loading" message="Montando a ficha completa…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  if (!sheet) return null;
  return (
    <div>
      <div className="mx-auto mb-3 flex max-w-[210mm] flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Valores de remuneração saem como XXXXXXXX. Para consultá-los, use a guia Remuneração.
        </p>
        <a
          href={`/employees/${encodeURIComponent(employeeId)}/ficha/print`}
          target="_blank"
          rel="noopener"
          data-testid="employee-record-sheet-open-print"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
        >
          <Printer className="h-4 w-4" aria-hidden />
          Imprimir / PDF
        </a>
      </div>
      <div className="rounded-md border border-border shadow-sm">
        <EmployeeRecordSheetDocument sheet={sheet} issuedAt={issuedAt} />
      </div>
    </div>
  );
}
