import React, { useState } from "react";
import { CalendarDays, PackagePlus, Pencil, ScanLine, Settings2 } from "lucide-react";
import { ProfileField, ProfileSection, ProfileState } from "./profileUi";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { EPI_DELIVERY_STATUS_LABELS } from "@/src/lib/epi/epiRules";
import { EpiCatalogModal } from "@/src/components/employee/epi/EpiCatalogModal";
import { EpiDeliveryModal, type EpiDeliveryModalMode } from "@/src/components/employee/epi/EpiDeliveryModal";
import { EpiEventModal, type EpiEventModalMode } from "@/src/components/employee/epi/EpiEventModal";
import { EpiEventDocuments } from "@/src/components/employee/epi/EpiEventDocuments";
import { EpiReceiptModal } from "@/src/components/employee/epi/EpiReceiptModal";
import {
  EPI_BTN_LINK,
  EPI_BTN_PRIMARY,
  EPI_BTN_SECONDARY,
  EpiDueBadge,
  EpiReasonPrompt,
  EpiStatusBadge,
  formatIsoDay,
  type EpiDelivery,
  type EpiEvent,
} from "@/src/components/employee/epi/epiUi";

type StatusAction = { kind: "CANCEL" | "CLOSE"; delivery: EpiDelivery };

function ItemRows({
  event,
  manageable,
  onReplace,
  onEdit,
  onStatus,
}: {
  event: EpiEvent;
  manageable: boolean;
  onReplace: (d: EpiDelivery) => void;
  onEdit: (d: EpiDelivery) => void;
  onStatus: (a: StatusAction) => void;
}) {
  return (
    <div className="relative overflow-x-auto">
      <table className="min-w-full text-sm" data-testid="epi-event-items">
        <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5">EPI / Uniforme</th>
            <th className="px-3 py-1.5 text-right">Qtd.</th>
            <th className="px-3 py-1.5">Próxima troca</th>
            <th className="px-3 py-1.5">Situação</th>
            {manageable ? <th className="px-3 py-1.5 text-right">Ações</th> : null}
          </tr>
        </thead>
        <tbody>
          {event.items.map((d) => {
            const isActive = d.status === "ACTIVE";
            const legacy = !d.itemId;
            return (
              <tr
                key={d.id}
                className={cn("border-t border-border/60 align-top", d.status === "CANCELLED" && "bg-muted/30 text-muted-foreground")}
                data-testid="epi-delivery-row"
                data-status={d.status}
              >
                <td className="min-w-[220px] px-3 py-2">
                  <p className={cn("font-medium text-foreground", d.status === "CANCELLED" && "line-through text-muted-foreground")}>
                    {d.itemCode ? <span className="mr-1 font-mono text-xs text-muted-foreground">{d.itemCode}</span> : null}
                    {d.item}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[d.itemCaNumber ? `CA ${d.itemCaNumber}` : null, d.size ? `Tam. ${d.size}` : null, legacy ? "Registro anterior ao cadastro" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {d.notes ? <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{d.notes}</p> : null}
                </td>
                <td className="px-3 py-2 text-right">{d.quantity}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {d.status === "CANCELLED" ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : d.replacementDueDate ? (
                    <div className="space-y-1">
                      <p>{formatIsoDay(d.replacementDueDate)}</p>
                      {isActive && d.dueBand ? <EpiDueBadge band={d.dueBand} daysLeft={d.daysLeft} /> : null}
                      {d.replacementAdjustReason ? (
                        <p className="max-w-[220px] whitespace-normal text-[11px] text-muted-foreground" title={d.replacementAdjustReason}>
                          Ajustado: {d.replacementAdjustReason}
                        </p>
                      ) : null}
                    </div>
                  ) : d.validUntil ? (
                    <p className="text-xs text-muted-foreground">Validade (legado): {formatIsoDay(d.validUntil)}</p>
                  ) : (
                    <span className="text-xs text-muted-foreground">Sem troca programada</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <EpiStatusBadge
                    status={d.status}
                    title={
                      d.statusReason
                        ? `${EPI_DELIVERY_STATUS_LABELS[d.status]}${d.statusChangedAt ? ` em ${formatIsoDay(d.statusChangedAt)}` : ""}${
                            d.statusChangedByName ? ` por ${d.statusChangedByName}` : ""
                          }: ${d.statusReason}`
                        : null
                    }
                  />
                  {d.statusReason && !isActive ? <p className="mt-1 max-w-[220px] text-[11px] text-muted-foreground">{d.statusReason}</p> : null}
                </td>
                {manageable ? (
                  <td className="px-3 py-2">
                    {isActive ? (
                      <div className="ml-auto flex max-w-[230px] flex-wrap justify-end gap-x-3 gap-y-1">
                        <button type="button" className={EPI_BTN_LINK} onClick={() => onReplace(d)}>
                          Substituir
                        </button>
                        {!legacy ? (
                          <button type="button" className={EPI_BTN_LINK} onClick={() => onEdit(d)}>
                            Corrigir
                          </button>
                        ) : null}
                        <button type="button" className={EPI_BTN_LINK} onClick={() => onStatus({ kind: "CLOSE", delivery: d })}>
                          Encerrar
                        </button>
                        <button type="button" className={cn(EPI_BTN_LINK, "text-rose-700")} onClick={() => onStatus({ kind: "CANCEL", delivery: d })}>
                          Cancelar
                        </button>
                      </div>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PeopleEpiTab({
  data,
  loading,
  error,
  employeeId,
  canManage,
  onSaved,
  hideSizes,
}: {
  data: {
    sizes?: Record<string, string | null>;
    events?: Array<Record<string, unknown>>;
    deliveries?: Array<Record<string, unknown>>;
  } | null;
  loading: boolean;
  error: string | null;
  employeeId?: string;
  canManage?: boolean;
  onSaved?: () => void;
  /** Oculta "Tamanhos atuais" (colunas do cadastro) — usado onde eles já são editados ao lado. */
  hideSizes?: boolean;
}) {
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [eventMode, setEventMode] = useState<EpiEventModalMode | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<EpiDeliveryModalMode | null>(null);
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);
  /** Anexar ficha assinada: da entrega (evento) ou pelo código impresso (null). */
  const [receiptFor, setReceiptFor] = useState<{ event: EpiEvent | null } | null>(null);
  if (loading) return <ProfileState kind="loading" message="Carregando EPI…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  const sizes = data?.sizes ?? {};
  const events = (data?.events ?? []) as unknown as EpiEvent[];
  const manageable = Boolean(canManage && employeeId && onSaved);
  const items = events.flatMap((e) => e.items);
  const active = items.filter((d) => d.status === "ACTIVE");
  const pending = active.filter((d) => d.dueBand).length;
  const awaiting = events.filter((e) => e.activeItemCount > 0 && e.document.status !== "VALIDATED").length;

  const refresh = () => onSaved?.();

  return (
    <div className="space-y-4" data-testid="people-epi-tab">
      {hideSizes ? null : (
        <ProfileSection title="Tamanhos atuais">
          <ProfileField label="Camiseta" value={sizes.shirtSize} />
          <ProfileField label="Calça" value={sizes.pantsSize} />
          <ProfileField label="Jaqueta" value={sizes.jacketSize} />
          <ProfileField label="Luva" value={sizes.gloveSize} />
          <ProfileField label="Calçado" value={sizes.shoeSize} />
          <ProfileField label="Observações" value={sizes.epiNotes} />
        </ProfileSection>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Entregas de EPI e uniformes</p>
          <p className="text-xs text-muted-foreground">
            {events.length} entrega(s) · {active.length} item(ns) vigente(s)
            {pending ? ` · ${pending} com troca vencida ou nos próximos 60 dias` : ""}
            {awaiting ? ` · ${awaiting} entrega(s) com ficha pendente de assinatura/validação` : ""}. Registros gravados na hora, independentes do botão
            “Salvar alterações”.
          </p>
        </div>
        {employeeId ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={EPI_BTN_SECONDARY} onClick={() => setCatalogOpen(true)} data-testid="epi-open-catalog">
              <Settings2 className="h-4 w-4" /> Gerenciar EPIs / Uniformes
            </button>
            {manageable ? (
              <button type="button" className={EPI_BTN_SECONDARY} onClick={() => setReceiptFor({ event: null })} data-testid="epi-attach-by-code">
                <ScanLine className="h-4 w-4" /> Anexar ficha pelo código
              </button>
            ) : null}
            {manageable ? (
              <button type="button" className={EPI_BTN_PRIMARY} onClick={() => setEventMode({ kind: "new" })} data-testid="epi-new-delivery">
                <PackagePlus className="h-4 w-4" /> Nova entrega
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma entrega registrada.</p>
      ) : (
        <div className="space-y-3" data-testid="epi-delivery-history">
          {events.map((ev) => (
            <section key={ev.id} className="rounded-xl border border-border bg-card" data-testid="epi-event-card" data-event-id={ev.id}>
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 bg-muted/20 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    Entrega de {formatIsoDay(ev.deliveredAt)}
                    <span className="font-normal text-muted-foreground">
                      · {ev.itemCount} {ev.itemCount === 1 ? "item" : "itens"}
                      {ev.responsibleName ? ` · por ${ev.responsibleName}` : ""}
                    </span>
                    {manageable && ev.activeItemCount > 0 ? (
                      <button
                        type="button"
                        className={cn(EPI_BTN_LINK, "font-normal")}
                        onClick={() => setEventMode({ kind: "edit", event: ev })}
                        title="Corrigir data / observações da entrega"
                      >
                        <Pencil className="inline h-3 w-3" /> Corrigir entrega
                      </button>
                    ) : null}
                  </p>
                  {ev.notes ? <p className="text-xs text-muted-foreground">{ev.notes}</p> : null}
                </div>
                {employeeId ? (
                  <div className="min-w-[260px] max-w-[460px]">
                    <EpiEventDocuments
                      employeeId={employeeId}
                      event={ev}
                      canManage={manageable}
                      onAttach={(event) => setReceiptFor({ event })}
                      onChanged={refresh}
                    />
                  </div>
                ) : null}
              </header>
              <ItemRows
                event={ev}
                manageable={manageable}
                onReplace={(d) => setDeliveryMode({ kind: "replace", delivery: d })}
                onEdit={(d) => setDeliveryMode({ kind: "edit", delivery: d })}
                onStatus={setStatusAction}
              />
            </section>
          ))}
        </div>
      )}

      {employeeId ? (
        <EpiCatalogModal open={catalogOpen} onClose={() => setCatalogOpen(false)} canManage={Boolean(canManage)} onChanged={refresh} />
      ) : null}
      {manageable && employeeId && eventMode ? (
        <EpiEventModal
          open
          mode={eventMode}
          employeeId={employeeId}
          onClose={() => setEventMode(null)}
          onManageCatalog={() => setCatalogOpen(true)}
          onSaved={() => {
            setEventMode(null);
            refresh();
          }}
        />
      ) : null}
      {manageable && employeeId && deliveryMode ? (
        <EpiDeliveryModal
          open
          mode={deliveryMode}
          employeeId={employeeId}
          onClose={() => setDeliveryMode(null)}
          onManageCatalog={() => setCatalogOpen(true)}
          onSaved={() => {
            setDeliveryMode(null);
            refresh();
          }}
        />
      ) : null}
      {manageable && employeeId && receiptFor ? (
        <EpiReceiptModal
          open
          employeeId={employeeId}
          event={receiptFor.event}
          onClose={() => setReceiptFor(null)}
          onSaved={() => {
            setReceiptFor(null);
            refresh();
          }}
        />
      ) : null}
      {manageable && employeeId && statusAction ? (
        <EpiReasonPrompt
          open
          title={statusAction.kind === "CANCEL" ? "Cancelar lançamento" : "Encerrar entrega"}
          confirmLabel={statusAction.kind === "CANCEL" ? "Cancelar lançamento" : "Encerrar"}
          danger={statusAction.kind === "CANCEL"}
          description={
            statusAction.kind === "CANCEL" ? (
              <>
                Use para lançamento incorreto deste item. O registro continua no histórico como <strong>Cancelado</strong>
                {statusAction.delivery.itemId ? "; se ele substituiu outra entrega, a anterior volta a ficar vigente" : ""}. A ficha já emitida não
                muda: a próxima emissão gera nova revisão sem este item.
              </>
            ) : (
              <>
                Encerra o ciclo de <strong>{statusAction.delivery.item}</strong> sem nova entrega (ex.: devolução, mudança de função). A troca prevista
                deixa de ser cobrada.
              </>
            )
          }
          onCancel={() => setStatusAction(null)}
          onConfirm={async (reason) => {
            await fetchJsonOk(
              `/api/employees/${employeeId}/epi-deliveries/${statusAction.delivery.id}/${statusAction.kind === "CANCEL" ? "cancel" : "close"}`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }
            );
            setStatusAction(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
