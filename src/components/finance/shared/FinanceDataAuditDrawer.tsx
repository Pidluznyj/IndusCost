import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { AdminMetricGrid } from "@/src/components/admin/adminUi";
import type { FinanceDataAuditSection } from "@/src/lib/financeDataAudit";
import { FINANCE_AUDIT_DRAWER_TITLE } from "@/src/lib/financeDataAuditCopy";
import { cn } from "@/src/lib/utils";

function AuditListSection({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; value: React.ReactNode; hint?: string }>;
}) {
  return (
    <section className="space-y-3" data-testid="finance-audit-section-list">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <AdminMetricGrid
        minColumnWidth={160}
        items={items.map((item) => ({
          label: item.label,
          value: String(item.value ?? "—"),
          subtitle: item.hint,
          variant: "neutral" as const,
        }))}
      />
    </section>
  );
}

function AuditParagraphsSection({ title, paragraphs }: { title: string; paragraphs: string[] }) {
  return (
    <section className="space-y-2" data-testid="finance-audit-section-paragraphs">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[#6B7280]">{title}</h3>
      <ul className="space-y-2 text-sm text-[#374151] leading-relaxed list-disc pl-4">
        {paragraphs.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </section>
  );
}

function AuditStatusSection({
  title,
  items,
}: {
  title: string;
  items: Array<{ text: string; ok?: boolean }>;
}) {
  return (
    <section className="space-y-2" data-testid="finance-audit-section-status">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[#6B7280]">{title}</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.text}
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm leading-snug",
              item.ok === false
                ? "border-amber-200 bg-amber-50 text-amber-950"
                : "border-emerald-200 bg-emerald-50 text-emerald-950"
            )}
          >
            {item.ok === false ? (
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            )}
            {item.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FinanceDataAuditDrawer({
  open,
  onClose,
  title = FINANCE_AUDIT_DRAWER_TITLE,
  sections,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  sections: FinanceDataAuditSection[];
  children?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/40"
      data-testid="finance-data-audit-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex h-[88vh] sm:h-full w-full sm:max-w-lg md:max-w-xl flex-col bg-white shadow-xl rounded-t-2xl sm:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3 shrink-0">
          <h2 className="text-base font-bold text-[#111827]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-[#F3F4F6] text-[#6B7280]"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {sections.map((section) => {
            if (section.kind === "list") {
              return (
                <div key={section.id}>
                  <AuditListSection title={section.title} items={section.items} />
                </div>
              );
            }
            if (section.kind === "paragraphs") {
              return (
                <div key={section.id}>
                  <AuditParagraphsSection title={section.title} paragraphs={section.paragraphs} />
                </div>
              );
            }
            return (
              <div key={section.id}>
                <AuditStatusSection title={section.title} items={section.items} />
              </div>
            );
          })}
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
