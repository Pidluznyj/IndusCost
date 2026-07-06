import React from "react";
import "./print-document.css";

export type PrintDocumentOrientation = "portrait" | "landscape";

export function PrintDocumentShell({
  children,
  rootId,
  className = "",
  lang = "pt-BR",
  footer,
}: {
  children: React.ReactNode;
  rootId?: string;
  className?: string;
  lang?: string;
  footer?: React.ReactNode;
}) {
  return (
    <div id={rootId}>
      <article className={`print-document ${className}`.trim()} lang={lang}>
        {children}
        {footer ? <footer className="print-document-footer">{footer}</footer> : null}
      </article>
    </div>
  );
}
