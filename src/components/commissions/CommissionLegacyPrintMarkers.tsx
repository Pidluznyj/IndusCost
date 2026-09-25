import React from "react";

/**
 * Marcadores dos documentos impressos de competência do histórico Nomus: faixa
 * `position: fixed` no topo e no rodapé (o navegador repete em TODA página
 * impressa) com texto explícito — não depende de cor nem de marca d'água.
 */
export function CommissionLegacyPrintPageMarkers({ pageMarker }: { pageMarker: string | null }) {
  if (!pageMarker) return null;
  return (
    <>
      <div
        className="comm-closing-legacy-page-marker comm-closing-legacy-page-marker--top"
        data-testid="commission-legacy-print-marker"
      >
        {pageMarker}
      </div>
      <div className="comm-closing-legacy-page-marker comm-closing-legacy-page-marker--bottom" aria-hidden>
        {pageMarker}
      </div>
    </>
  );
}

/** Avisos da primeira página do espelho técnico (fonte oficial, origem, uso proibido). */
export function CommissionLegacyPrintNotices({ notices }: { notices: string[] }) {
  if (notices.length === 0) return null;
  return (
    <div className="comm-closing-legacy-notice" role="note" data-testid="commission-legacy-print-notice">
      {notices.map((notice) => (
        <p key={notice}>{notice}</p>
      ))}
    </div>
  );
}
