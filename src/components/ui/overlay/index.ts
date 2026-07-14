/**
 * Overlay Design System
 * ---------------------------------------------------------------------------
 * Padrão canônico para popups, dialogs, drawers e telas de detalhe que
 * abrem sobrepostas ao conteúdo. Ver `docs/design-system/overlay.md`.
 *
 * Uso rápido:
 *
 * ```tsx
 * import {
 *   Overlay,
 *   OverlayBody,
 *   OverlayHeader,
 *   OverlayFooter,
 *   OverlaySection,
 *   OverlayFieldGrid,
 *   OverlayField,
 *   OverlayInput,
 * } from "@/src/components/ui/overlay";
 *
 * function MyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
 *   return (
 *     <Overlay open={open} onClose={onClose} size="md" ariaLabelledBy="my-title" testId="my-dialog">
 *       <OverlayHeader
 *         titleId="my-title"
 *         eyebrow="Financeiro · Conciliação"
 *         title="Editar recebimento"
 *         subtitle="Alterações não afetam títulos já baixados."
 *         onClose={onClose}
 *       />
 *       <OverlayBody>
 *         <OverlaySection title="Dados do pagamento">
 *           <OverlayFieldGrid columns={2}>
 *             <OverlayField label="Data" required>
 *               {(p) => <OverlayInput {...p} type="date" />}
 *             </OverlayField>
 *             <OverlayField label="Valor" required>
 *               {(p) => <OverlayInput {...p} type="number" step="0.01" />}
 *             </OverlayField>
 *           </OverlayFieldGrid>
 *         </OverlaySection>
 *       </OverlayBody>
 *       <OverlayFooter>
 *         <button type="button" onClick={onClose}>Cancelar</button>
 *         <button type="submit">Salvar</button>
 *       </OverlayFooter>
 *     </Overlay>
 *   );
 * }
 * ```
 */

export { Overlay, OverlayBody } from "./Overlay";
export type { OverlayProps, OverlaySize } from "./Overlay";

export { OverlayHeader } from "./OverlayHeader";
export type {
  OverlayHeaderProps,
  OverlayHeaderVariant,
  OverlayHeaderDensity,
} from "./OverlayHeader";

export { OverlayFooter } from "./OverlayFooter";
export type { OverlayFooterProps } from "./OverlayFooter";

export { OverlayTabs } from "./OverlayTabs";
export type { OverlayTabsProps, OverlayTab } from "./OverlayTabs";

export { OverlayKpiCard, OverlayKpiCardGrid } from "./OverlayKpiCard";
export type { OverlayKpiCardProps, OverlayKpiCardTone } from "./OverlayKpiCard";

export { OverlaySection } from "./OverlaySection";
export type { OverlaySectionProps } from "./OverlaySection";

export { OverlayTable } from "./OverlayTable";

export { OverlayField, OverlayFieldGrid } from "./OverlayField";
export type { OverlayFieldProps, OverlayFieldDensity } from "./OverlayField";

export {
  OverlayInput,
  OverlayTextarea,
  OverlaySelect,
  OVERLAY_CONTROL_CLASS,
} from "./OverlayInput";
export type {
  OverlayInputProps,
  OverlayTextareaProps,
  OverlaySelectProps,
} from "./OverlayInput";

export { OverlayBadge } from "./OverlayBadge";
export type { OverlayBadgeProps, OverlayBadgeTone } from "./OverlayBadge";
