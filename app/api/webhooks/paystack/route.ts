import { handlePaymentWebhook } from "@/lib/booking/webhook";
import { getPaymentProvider } from "@/lib/payments/factory";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // The signature covers the raw body, so read it as text before anything parses it.
  const rawBody = await request.text();
  const admin = createAdminClient();
  const result = await handlePaymentWebhook({
    rawBody,
    signature: request.headers.get("x-paystack-signature"),
    provider: getPaymentProvider(),
    rpc: (fn, args) => admin.rpc(fn, args),
  });
  return Response.json(result.body, { status: result.status });
}
