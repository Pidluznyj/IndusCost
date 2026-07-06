import React from "react";
import { cn } from "@/src/lib/utils";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { ExecutivePrintPageHeader } from "@/src/components/finance/executive-report/ExecutivePrintPageHeader";
import { ExecutivePrintPageFooter } from "@/src/components/finance/executive-report/ExecutivePrintPageFooter";

export function ExecutivePrintPageShell({
  pageId,
  pageNumber,
  cover = false,
  allowContentFlow = false,
  header,
  generatedAt,
  children,
  className,
}: {
  pageId: string;
  pageNumber: number;
  cover?: boolean;
  /** Permite que o conteúdo ultrapasse uma página física (ex.: Radar Diário com grids AR/AP). */
  allowContentFlow?: boolean;
  header?: {
    branding: BrandingSettingsDTO;
    periodLabel: string;
    reportDateLabel: string;
    companyLabel: string;
  };
  generatedAt: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "executive-print-page",
        cover && "executive-print-page--cover",
        allowContentFlow && "executive-print-page--flow",
        className
      )}
      data-print-page={pageId}
      data-testid={`executive-print-page-${pageId}`}
    >
      {!cover && header ? (
        <ExecutivePrintPageHeader
          branding={header.branding}
          periodLabel={header.periodLabel}
          reportDateLabel={header.reportDateLabel}
          companyLabel={header.companyLabel}
        />
      ) : null}
      <div className="executive-print-page-body">{children}</div>
      {!cover ? (
        <ExecutivePrintPageFooter pageNumber={pageNumber} generatedAt={generatedAt} />
      ) : null}
    </article>
  );
}
