import React from "react";

export function PrintSection({
  title,
  children,
  flow = false,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  flow?: boolean;
  className?: string;
}) {
  return (
    <section className={`print-section ${flow ? "print-section--flow" : ""} ${className}`.trim()}>
      <h2 className="print-section-title">{title}</h2>
      {children}
    </section>
  );
}
