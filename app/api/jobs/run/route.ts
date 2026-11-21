import { createAdminClient } from "@/lib/supabase/admin";
import { createEmailStore, sendDueEmails, type Rpc } from "@/lib/email/outbox";
import { createResendSender } from "@/lib/email/send";
import { reverifyPendingPayments } from "@/lib/booking/confirm";
import { getPaymentProvider } from "@/lib/payments/factory";
import { createJobsHandler } from "@/lib/jobs/handler";
import type { Job } from "@/lib/jobs/registry";

export const dynamic = "force-dynamic";

function getJobs(): Job[] {
  const db = createAdminClient();
  const rpc: Rpc = (fn, args) => db.rpc(fn, args);
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.EMAIL_FROM ?? "";
  return [
    {
      name: "send-emails",
      run: () => sendDueEmails({ store: createEmailStore(rpc), sender: createResendSender({ apiKey, from }) }),
    },
    {
      name: "reverify-payments",
      run: () => reverifyPendingPayments({ rpc, provider: getPaymentProvider() }),
    },
    {
      name: "purge-old-data",
      run: async () => {
        const { error } = await rpc("purge_old_data");
        if (error) throw new Error(error.message);
      },
    },
  ];
}

export async function POST(request: Request) {
  return createJobsHandler({ secret: process.env.JOB_SECRET, getJobs })(request);
}
