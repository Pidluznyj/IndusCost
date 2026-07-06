import { CommissionsArViewPage } from "@/src/components/commissions/arViews/CommissionsArViewPage";
import { CommissionsConfirmedPage } from "@/src/components/commissions/pages/CommissionsConfirmedPage";

export function CommissionsPayablePage() {
  return <CommissionsArViewPage mode="payable" />;
}

export function CommissionsGeneratedPage() {
  return <CommissionsConfirmedPage variant="generated" />;
}

export function CommissionsFuturePage() {
  return <CommissionsArViewPage mode="future" />;
}

export function CommissionsOverduePage() {
  return <CommissionsArViewPage mode="overdue" />;
}
