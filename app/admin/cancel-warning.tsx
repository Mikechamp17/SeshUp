import { formatRand } from "@/lib/money/fees";
import { Alert } from "../ui";

export type CancelPreview = { booked: number; refund_total_cents: number; waitlisted: number };

/** What cancelling a class date will do to the people booked on it. */
export function CancelWarning({ preview }: { preview: CancelPreview }) {
  return (
    <Alert kind="error" role="alert" title="This cannot be undone">
      {preview.booked} booked member{preview.booked === 1 ? "" : "s"} will be refunded {formatRand(preview.refund_total_cents)} in total and emailed
      {preview.waitlisted > 0 ? `. ${preview.waitlisted} waitlisted member${preview.waitlisted === 1 ? "" : "s"} will be removed from the waitlist` : ""}.
    </Alert>
  );
}
