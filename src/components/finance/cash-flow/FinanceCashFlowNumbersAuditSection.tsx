import React, { useState } from "react";
import type { FinanceCashFlowDashboardPayload } from "@/src/lib/financeCashFlowDashboardTypes";
import { FINANCE_CF_HELP_AUDIT_SECTION } from "@/src/lib/financeCashFlowBlockHelp";
import { FinanceBiCollapsibleSection } from "@/src/components/finance/bi/FinanceBiCollapsibleSection";
import { FinanceCashFlowNumbersAuditPanel } from "@/src/components/finance/cash-flow/FinanceCashFlowNumbersAuditPanel";

type Props = {
  appliedQuery: string;
  payload: FinanceCashFlowDashboardPayload;
};

/** Accordion discreto com sync, cutoffs e exclusões — carrega auditoria só ao expandir. */
export function FinanceCashFlowNumbersAuditSection({ appliedQuery, payload }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <FinanceBiCollapsibleSection
      testId="cash-flow-numbers-audit"
      title="Auditoria dos números"
      subtitle={FINANCE_CF_HELP_AUDIT_SECTION}
      defaultExpanded={false}
      onExpandedChange={setExpanded}
    >
      <FinanceCashFlowNumbersAuditPanel
        active={expanded}
        appliedQuery={appliedQuery}
        dataSanitization={payload.dataSanitization}
        reconciliation={payload.reconciliation}
        lastSyncAt={payload.cards.lastSyncAt}
      />
    </FinanceBiCollapsibleSection>
  );
}
