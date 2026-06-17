import React from "react";

export function ExecutiveSectionHeader({
  title,
  subtitle,
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
}) {
  return (
    <header className="finance-executive-section-header">
      {eyebrow ? <p className="finance-executive-section-eyebrow">{eyebrow}</p> : null}
      <h2 className="finance-executive-report-section-title">{title}</h2>
      {subtitle ? <p className="finance-executive-report-section-subtitle">{subtitle}</p> : null}
    </header>
  );
}
