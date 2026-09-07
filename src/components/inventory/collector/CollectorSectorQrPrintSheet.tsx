/**
 * Folha do QR GERAL DE SETOR — componente canônico.
 *
 * A mesma folha é usada por Estoque → Etiquetas QR (`/inventory-labels`) e por
 * Estoque → Dispositivos do Coletor ("Imprimir QR"), tanto na impressão quanto
 * na pré-visualização em tela. Existe para que as duas telas nunca voltem a
 * imprimir folhas diferentes.
 *
 * Conteúdo, e só ele: nome do setor, o que o QR faz, o QR e como ler. Sem URL
 * crua, sem botões, sem cromo da aplicação (ver
 * docs/stock-collector-autonomous-sector.md, "QR GERAL DE SETOR").
 *
 * Sem import de CSS aqui de propósito: o layout vive em
 * `collector-sector-qr-sheet.css`, importado pelas telas consumidoras. Assim o
 * componente é testável com renderToStaticMarkup sem loader de CSS.
 */
import React from "react";
import { QRCodeSVG } from "qrcode.react";

export const COLLECTOR_SECTOR_QR_SHEET_CLASS = "collector-sector-qr-sheet";
export const COLLECTOR_SECTOR_QR_SHEET_PREVIEW_CLASS = "collector-sector-qr-sheet--preview";

/** Tamanho em px na tela; na impressão o CSS escala o SVG (viewBox) para 100mm. */
export const COLLECTOR_SECTOR_QR_SIZE_PX = 220;

/**
 * Alta correção de erro: o QR sai impresso e fixado fisicamente na área —
 * precisa continuar legível sujo, amassado ou com reflexo de luz.
 */
export const COLLECTOR_SECTOR_QR_ERROR_LEVEL = "H" as const;

export const COLLECTOR_SECTOR_QR_PURPOSE =
  "Este QR abre a contagem de estoque deste setor no tablet.";

export const COLLECTOR_SECTOR_QR_HOWTO_TITLE = "Como ler:";

export const COLLECTOR_SECTOR_QR_HOWTO_STEPS: readonly string[] = [
  "Abra a câmera do tablet.",
  "Aponte para o QR até aparecer o aviso de link na tela.",
  "Toque no aviso para abrir a contagem.",
  "Conte os itens do setor pelo próprio tablet.",
];

export type CollectorSectorQrPrintSheetProps = {
  /** Rótulo oficial do setor (ex.: "Matéria-prima") — vem do backend. */
  label: string;
  /** Deep-link absoluto do setor — resolvido inteiramente pelo backend. */
  url: string;
  /**
   * `print` (default): só aparece no papel (oculto na tela pelo CSS).
   * `preview`: pré-visualização em tela com o mesmo conteúdo; nunca imprime.
   */
  mode?: "print" | "preview";
  testId?: string;
};

export function CollectorSectorQrPrintSheet({
  label,
  url,
  mode = "print",
  testId,
}: CollectorSectorQrPrintSheetProps) {
  const className =
    mode === "preview"
      ? `${COLLECTOR_SECTOR_QR_SHEET_CLASS} ${COLLECTOR_SECTOR_QR_SHEET_PREVIEW_CLASS}`
      : COLLECTOR_SECTOR_QR_SHEET_CLASS;
  return (
    <section className={className} data-testid={testId} data-mode={mode} aria-label={`QR de setor — ${label}`}>
      <h1>{label}</h1>
      <p className="sector-purpose">{COLLECTOR_SECTOR_QR_PURPOSE}</p>
      <QRCodeSVG
        value={url}
        size={COLLECTOR_SECTOR_QR_SIZE_PX}
        level={COLLECTOR_SECTOR_QR_ERROR_LEVEL}
        marginSize={2}
        role="img"
        aria-label={`QR do setor ${label}`}
      />
      <div className="sector-howto">
        <strong>{COLLECTOR_SECTOR_QR_HOWTO_TITLE}</strong>
        <ol>
          {COLLECTOR_SECTOR_QR_HOWTO_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}
