import React from "react";
import {
  AlertTriangle,
  CalendarClock,
  FileWarning,
  Package,
  Receipt,
  Wallet,
} from "lucide-react";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import {
  formatFinanceCurrencyCompact,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import type {
  PortfolioBusinessAnswerFilterHint,
  PortfolioBusinessAnswers,
} from "@/src/lib/financePortfolioReconciliationClient";
import { cn } from "@/src/lib/utils";

type Props = {
  answers: PortfolioBusinessAnswers;
  onFilterHint?: (hint: PortfolioBusinessAnswerFilterHint) => void;
};

function CardShell({
  hint,
  onFilterHint,
  testId,
  children,
}: {
  hint: PortfolioBusinessAnswerFilterHint;
  onFilterHint?: (hint: PortfolioBusinessAnswerFilterHint) => void;
  testId?: string;
  children: React.ReactNode;
}) {
  const interactive = Boolean(onFilterHint);
  return (
    <div
      data-testid={testId}
      className={cn(interactive && "cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onFilterHint?.(hint) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onFilterHint?.(hint);
              }
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

export function PortfolioReconciliationSummaryCardsView({
  answers,
  onFilterHint,
}: Props) {
  const quando = answers.quandoVouReceber;
  const quandoValue = quando.nextDateLabel ?? "Sem data confiável";
  const quandoSubtitle = `${formatFinanceCurrencyCompact(quando.next30DaysValue)} nos próximos 30 dias`;

  return (
    <div
      className={SYSTEM_TOTALIZER_GRID_CLASS}
      data-testid="portfolio-reconciliation-summary-cards"
    >
      <CardShell hint={answers.quantoTenhoParaReceber.filterHint} onFilterHint={onFilterHint}>
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Tenho para receber"
          value={formatFinanceCurrencyCompact(answers.quantoTenhoParaReceber.value)}
          icon={Wallet}
          tone="money"
          subtitle={answers.quantoTenhoParaReceber.explanation}
        />
      </CardShell>

      <CardShell
        hint={answers.quandoVouReceber.filterHint}
        onFilterHint={onFilterHint}
        testId="portfolio-card-quando-vou-receber"
      >
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Quando vou receber"
          value={quandoValue}
          icon={CalendarClock}
          tone="info"
          subtitle={quandoSubtitle}
        />
        <ul className="mt-1.5 space-y-0.5 px-1 text-[10px] text-muted-foreground">
          {quando.buckets.map((b) => (
            <li key={b.id} className="flex justify-between gap-2 tabular-nums">
              <span>{b.label}</span>
              <span>{formatFinanceCurrencyCompact(b.value)}</span>
            </li>
          ))}
        </ul>
      </CardShell>

      <CardShell hint={answers.jaVirouContasReceber.filterHint} onFilterHint={onFilterHint}>
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Já virou Contas a Receber"
          value={formatFinanceCurrencyCompact(answers.jaVirouContasReceber.value)}
          icon={Receipt}
          tone="success"
          subtitle={answers.jaVirouContasReceber.explanation}
        />
      </CardShell>

      <CardShell
        hint={answers.faturadoSemContasReceber.filterHint}
        onFilterHint={onFilterHint}
      >
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Faturado, mas sem CR"
          value={formatFinanceCurrencyCompact(answers.faturadoSemContasReceber.value)}
          icon={FileWarning}
          tone="warning"
          subtitle={answers.faturadoSemContasReceber.explanation}
        />
      </CardShell>

      <CardShell hint={answers.soPedidoCarteira.filterHint} onFilterHint={onFilterHint}>
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Só pedido em carteira"
          value={formatFinanceCurrencyCompact(answers.soPedidoCarteira.value)}
          icon={Package}
          tone="neutral"
          subtitle={answers.soPedidoCarteira.explanation}
        />
      </CardShell>

      <CardShell hint={answers.precisaRevisar.filterHint} onFilterHint={onFilterHint}>
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Precisa revisar"
          value={formatFinanceInteger(answers.precisaRevisar.ordersCount)}
          icon={AlertTriangle}
          tone="danger"
          subtitle={`${formatFinanceInteger(answers.precisaRevisar.alertsCount)} alertas encontrados`}
        />
      </CardShell>
    </div>
  );
}
