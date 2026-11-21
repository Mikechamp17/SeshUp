import { isTemplateName, renderEmail, type EmailData } from "@/lib/email/templates";
import type { EmailSender } from "@/lib/email/send";

/** The shape of supabase-js `rpc`, so the store runs against the real SQL functions in tests. */
export type Rpc = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export type OutboxRow = { id: string; template: string; recipient: string; data: EmailData };

export interface EmailStore {
  claimDue(limit: number): Promise<OutboxRow[]>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

export function createEmailStore(rpc: Rpc): EmailStore {
  const check = (error: { message: string } | null) => {
    if (error) throw new Error(error.message);
  };
  return {
    async claimDue(limit) {
      const { data, error } = await rpc("claim_due_emails", { p_limit: limit });
      check(error);
      return (data ?? []) as OutboxRow[];
    },
    async markSent(id) {
      check((await rpc("mark_email_sent", { p_id: id })).error);
    },
    async markFailed(id, message) {
      check((await rpc("mark_email_failed", { p_id: id, p_error: message })).error);
    },
  };
}

/** Sends due outbox rows. A row is marked sent only after the provider accepts it. */
export async function sendDueEmails(options: { store: EmailStore; sender: EmailSender; limit?: number }) {
  const rows = await options.store.claimDue(options.limit ?? 50);
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (!isTemplateName(row.template)) throw new Error(`Unknown email template: ${row.template}`);
      const { subject, html } = renderEmail(row.template, row.data);
      await options.sender.send({ to: row.recipient, subject, html });
      await options.store.markSent(row.id);
      sent++;
    } catch (e) {
      failed++;
      await options.store.markFailed(row.id, e instanceof Error ? e.message : String(e));
    }
  }
  return { sent, failed };
}
