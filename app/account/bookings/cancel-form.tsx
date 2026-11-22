"use client";

import { useState } from "react";

/** The confirm step of a cancellation. A cancellation with no refund needs the member to tick that they understand. */
export function CancelForm({
  action,
  bookingId,
  refundable,
  amount,
}: {
  action: (formData: FormData) => Promise<void>;
  bookingId: string;
  refundable: boolean;
  amount: string;
}) {
  const [understood, setUnderstood] = useState(false);
  const blocked = !refundable && !understood;
  return (
    <form action={action}>
      <input type="hidden" name="bookingId" value={bookingId} />
      {!refundable ? (
        <label className="check">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <span>I understand I will not get {amount} back.</span>
        </label>
      ) : null}
      <button type="submit" className="btn btn-danger btn-block" disabled={blocked}>
        {refundable ? `Cancel and refund ${amount}` : "Cancel with no refund"}
      </button>
    </form>
  );
}
