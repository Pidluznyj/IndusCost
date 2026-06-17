import React from "react";
import { cn } from "@/src/lib/utils";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { ExecutivePrintPageHeader } from "@/src/components/finance/executive-report/ExecutivePrintPageHeader";
import { ExecutivePrintPageFooter } from "@/src/components/finance/executive-report/ExecutivePrintPageFooter";

export const EXECUTIVE_REPORT_PRINT_TOTAL_PAGES = 9;

export function ExecutivePrintPageShell({
  pageId,
  pageNumber,
  cover = false,
  header,
  generatedAt,
  children,
  className,
}: {
  pageId: string;
  pageNumber: number;
  cover?: boolean;
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
        <ExecutivePrintPageFooter
          pageNumber={pageNumber}
          totalPages={EXECUTIVE_REPORT_PRINT_TOTAL_PAGES}
          generatedAt={generatedAt}
        />
      ) : null}
    </article>
  );
}
