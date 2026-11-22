import { formatRand } from "@/lib/money/fees";
import { formatGymDateTime } from "@/lib/time/gym-time";

export type EmailData = {
  gymName: string;
  className: string;
  startsAt: string;
  timezone: string;
  amountCents?: number;
  newStartsAt?: string;
  offerEnd?: string;
  classUrl?: string;
  /** A site-relative path to the class page. The sender adds the site address. */
  classPath?: string;
  /** Owner invite: the link built when the invite was created. */
  inviteUrl?: string;
  /** Existing member made owner: where to sign in to the admin page. */
  signInUrl?: string;
};

export type RenderedEmail = { subject: string; html: string };

export const TEMPLATE_NAMES = [
  "booking_confirmed",
  "booking_cancelled_refund",
  "booking_cancelled_no_refund",
  "refund_processed",
  "class_cancelled_by_gym",
  "class_time_changed",
  "late_payment_refund",
  "waitlist_offer",
  "owner_invite",
  "owner_added",
] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

/** Gym-owned text (gym and class names) is escaped wherever it is rendered into HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrap(title: string, lines: string[]): string {
  const body = lines.map((l) => `<p style="margin:0 0 12px">${l}</p>`).join("");
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:16px"><h2 style="margin:0 0 16px">${escapeHtml(title)}</h2>${body}</div>`;
}

export function isTemplateName(name: string): name is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(name);
}

export function renderEmail(template: TemplateName, data: EmailData, baseUrl?: string): RenderedEmail {
  const gym = escapeHtml(data.gymName);
  const cls = escapeHtml(data.className);
  const when = escapeHtml(formatGymDateTime(data.startsAt, data.timezone));
  const amount = data.amountCents === undefined ? "" : escapeHtml(formatRand(data.amountCents));
  const classLine = `${cls} at ${gym}, ${when}.`;

  switch (template) {
    case "booking_confirmed":
      return {
        subject: `Booked: ${data.className}`,
        html: wrap("You're booked", [classLine, amount ? `You paid ${amount}.` : ""].filter(Boolean)),
      };
    case "booking_cancelled_refund":
      return {
        subject: `Cancelled: ${data.className}`,
        html: wrap("Booking cancelled", [classLine, amount ? `A full refund of ${amount} is on its way.` : "A full refund is on its way."]),
      };
    case "booking_cancelled_no_refund":
      return {
        subject: `Cancelled: ${data.className}`,
        html: wrap("Booking cancelled", [classLine, "This was after the cancellation cutoff, so there is no refund. Your spot has been released."]),
      };
    case "refund_processed":
      return {
        subject: "Your refund is done",
        html: wrap("Refund processed", [classLine, amount ? `${amount} has been refunded to your card.` : "Your refund has been processed."]),
      };
    case "class_cancelled_by_gym":
      return {
        subject: `Class cancelled: ${data.className}`,
        html: wrap("Class cancelled", [`${gym} has cancelled ${cls} on ${when}.`, "You will get a full refund."]),
      };
    case "class_time_changed": {
      const newWhen = data.newStartsAt ? escapeHtml(formatGymDateTime(data.newStartsAt, data.timezone)) : "a new time";
      return {
        subject: `Time changed: ${data.className}`,
        html: wrap("Class time changed", [
          `${gym} moved ${cls} from ${when} to ${newWhen}.`,
          "If the new time does not suit you, you can cancel for a full refund until the class starts.",
        ]),
      };
    }
    case "late_payment_refund":
      return {
        subject: `Spot no longer available: ${data.className}`,
        html: wrap("Your spot was not available", [
          `Your payment for ${cls} at ${gym}, ${when}, arrived after the spot had gone to someone else.`,
          amount ? `We are refunding ${amount} in full.` : "We are refunding you in full.",
        ]),
      };
    case "waitlist_offer": {
      const until = data.offerEnd ? escapeHtml(formatGymDateTime(data.offerEnd, data.timezone)) : "soon";
      const url = data.classUrl ?? (data.classPath && baseUrl ? `${baseUrl.replace(/\/$/, "")}${data.classPath}` : undefined);
      const link = url ? ` <a href="${escapeHtml(url)}">Book your spot</a>.` : "";
      return {
        subject: `A spot opened: ${data.className}`,
        html: wrap("A spot opened up", [classLine, `It is held for you until ${until}. Book and pay before then or it goes to the next person.${link}`]),
      };
    }
    case "owner_invite": {
      const link = data.inviteUrl ? ` <a href="${escapeHtml(data.inviteUrl)}">Choose your password</a> to get started.` : "";
      return {
        subject: `You're invited to run ${data.gymName} on SeshUp`,
        html: wrap("You're invited", [`You have been invited to manage ${gym} on SeshUp, where members book your classes.${link}`]),
      };
    }
    case "owner_added": {
      const link = data.signInUrl ? ` <a href="${escapeHtml(data.signInUrl)}">Sign in to your admin page</a>.` : "";
      return {
        subject: `You now manage ${data.gymName} on SeshUp`,
        html: wrap("You now manage a gym", [`You have been added as an owner of ${gym} on SeshUp.${link}`]),
      };
    }
  }
}
