import React, { createContext, useContext } from "react";

const ExecutiveReportPrintContext = createContext(false);

export function ExecutiveReportPrintProvider({
  pdfMode,
  children,
}: {
  pdfMode: boolean;
  children: React.ReactNode;
}) {
  return (
    <ExecutiveReportPrintContext.Provider value={pdfMode}>{children}</ExecutiveReportPrintContext.Provider>
  );
}

export function useExecutiveReportPdfMode(): boolean {
  return useContext(ExecutiveReportPrintContext);
}
