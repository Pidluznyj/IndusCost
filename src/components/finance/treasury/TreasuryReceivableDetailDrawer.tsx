import React from "react";
import type { TreasuryReceivableListItemDto } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_PRIORITY_LABELS,
  TREASURY_RECEIVABLE_STATUS_LABELS,
  TREASURY_RECEIVABLE_STATUS_TONES,
  buildTreasuryReceivableOperationalHistory,
  formatTreasuryReceivableDate,
  formatTreasuryReceivableDateTime,
  formatTreasuryReceivableMoney,
} from "@/src/lib/treasury/treasuryReceivablesUi.js";
import {
  Overlay,
  OverlayBadge,
  OverlayBody,
  OverlayHeader,
  OverlaySection,
} from "@/src/components/ui/overlay";

export type TreasuryReceivableDetailDrawerProps = {
  open: boolean;
  row: TreasuryReceivableListItemDto | null;
  onClose: () => void;
};

export function TreasuryReceivableDetailDrawer({
  open,
  row,
  onClose,
}: TreasuryReceivableDetailDrawerProps) {
  if (!row) return null;
  const history = buildTreasuryReceivableOperationalHistory(row);
  const statusLabel =
    TREASURY_RECEIVABLE_STATUS_LABELS[row.operationalStatus];
  const statusTone = TREASURY_RECEIVABLE_STATUS_TONES[row.operationalStatus];

  return (
    <Overlay
      open={open}
      onClose={onClose}
      size="lg"
      ariaLabelledBy="treasury-receivable-drawer-title"
      testId="treasury-receivable-detail-drawer"
    >
      <OverlayHeader
        titleId="treasury-receivable-drawer-title"
        eyebrow="Tesouraria · Contas a receber"
        title={row.official.counterparty.name ?? `Título #${row.externalId}`}
        subtitle={`Nomus ${row.externalId} · venc. ${formatTreasuryReceivableDate(row.official.dueDate)}`}
        onClose={onClose}
        actions={
          <OverlayBadge tone={statusTone} variant="soft">
            {statusLabel}
          </OverlayBadge>
        }
      />
      <OverlayBody>
        <div className="space-y-5" data-testid="treasury-receivable-detail-body">
          <OverlaySection title="Título oficial">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
              <Field label="Cliente" value={row.official.counterparty.name} />
              <Field label="CNPJ/CPF" value={row.official.counterparty.taxId} />
              <Field
                label="Valor original"
                value={formatTreasuryReceivableMoney(row.official.originalAmount)}
              />
              <Field
                label="Saldo aberto"
                value={formatTreasuryReceivableMoney(row.openAmount)}
              />
              <Field
                label="Valor recebido"
                value={formatTreasuryReceivableMoney(row.receivedAmount)}
              />
              <Field
                label="Emissão (competência)"
                value={formatTreasuryReceivableDate(row.official.issuedOn)}
              />
              <Field
                label="Vencimento oficial"
                value={formatTreasuryReceivableDate(row.official.dueDate)}
              />
              <Field
                label="Dias de atraso"
                value={String(row.daysOverdue)}
              />
              <Field
                label="Descrição"
                value={row.official.description}
                className="sm:col-span-2"
              />
            </dl>
          </OverlaySection>

          <OverlaySection title="Pedido e nota fiscal">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
              <Field
                label="Pedido"
                value={
                  row.official.salesOrderCode ??
                  (row.official.salesOrderExternalId != null
                    ? String(row.official.salesOrderExternalId)
                    : null)
                }
              />
              <Field
                label="Nota fiscal"
                value={
                  row.official.invoice.number ??
                  (row.official.invoice.externalId != null
                    ? String(row.official.invoice.externalId)
                    : null)
                }
              />
              <Field label="Vendedor" value={row.sellerName} />
              <Field
                label="Resp. comercial"
                value={row.commercialOwnerName}
              />
            </dl>
          </OverlaySection>

          <OverlaySection title="Complemento operacional">
            {row.complement ? (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
                <Field
                  label="Data esperada"
                  value={formatTreasuryReceivableDate(
                    row.complement.expectedDate
                  )}
                />
                <Field
                  label="Data confirmada"
                  value={formatTreasuryReceivableDate(
                    row.complement.confirmedDate
                  )}
                />
                <Field
                  label="Prioridade"
                  value={
                    TREASURY_PRIORITY_LABELS[row.complement.priority] ??
                    row.complement.priority
                  }
                />
                <Field
                  label="Responsável cobrança"
                  value={row.complement.responsibleUserId}
                />
                <Field
                  label="Próxima ação"
                  value={row.nextAction}
                  className="sm:col-span-2"
                />
                <Field
                  label="Motivo"
                  value={row.complement.reason}
                  className="sm:col-span-2"
                />
                <Field
                  label="Observações"
                  value={row.complement.notes}
                  className="sm:col-span-2"
                />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                Sem complemento operacional local para este título.
              </p>
            )}
          </OverlaySection>

          <OverlaySection title="Histórico operacional">
            <ul
              className="space-y-2"
              data-testid="treasury-receivable-history"
            >
              {history.map((item, idx) => (
                <li
                  key={`${item.at}-${idx}`}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <p className="font-semibold">{item.label}</p>
                  <p className="text-muted-foreground">{item.detail}</p>
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    {formatTreasuryReceivableDateTime(item.at)}
                  </p>
                </li>
              ))}
            </ul>
          </OverlaySection>
        </div>
      </OverlayBody>
    </Overlay>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null | undefined;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium text-foreground">{value?.trim() || "—"}</dd>
    </div>
  );
}
