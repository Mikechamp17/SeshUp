export type OutgoingEmail = { to: string; subject: string; html: string };

export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}

/** Sends through Resend. Throws on any non-2xx reply so the outbox row is retried. */
export function createResendSender(options: { apiKey: string; from: string; fetchImpl?: typeof fetch }): EmailSender {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async send({ to, subject, html }) {
      const res = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: options.from, to, subject, html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Resend replied ${res.status}: ${text.slice(0, 200)}`);
      }
    },
  };
}
