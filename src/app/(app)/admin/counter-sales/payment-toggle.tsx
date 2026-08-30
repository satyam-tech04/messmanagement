"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toggleBillPayment, type SaleActionState } from "@/app/(app)/staff/sales/actions";

function Inner({ paid }: { paid: boolean }) {
  const { pending } = useFormStatus();
  if (pending) return <Loader2 className="size-4 animate-spin" aria-hidden="true" />;
  return <>{paid ? "Mark unpaid" : "Mark paid"}</>;
}

/**
 * Flips a finalised bill between paid and unpaid.
 *
 * Never changes the total and never changes the day's revenue — a finalised
 * unpaid bill counts in full (spec §10). It only answers "has the cash come in
 * yet?".
 */
export function PaymentToggle({
  billId,
  paymentStatus,
}: {
  billId: string;
  paymentStatus: string;
}) {
  const [state, formAction] = useActionState(
    toggleBillPayment.bind(null, billId),
    {} as SaleActionState,
  );

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <Button type="submit" variant="outline" size="sm">
        <Inner paid={paymentStatus === "PAID"} />
      </Button>
      {state.error ? (
        <span role="alert" className="text-destructive text-xs">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
