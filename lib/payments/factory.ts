import { createPaystackProvider } from "@/lib/payments/paystack";
import type { PaymentProvider } from "@/lib/payments/provider";

/** The payment provider for server code. Tests pass the fake as an override. */
export function getPaymentProvider(override?: PaymentProvider): PaymentProvider {
  if (override) return override;
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) throw new Error("PAYSTACK_SECRET_KEY is not set");
  return createPaystackProvider({ secretKey });
}
