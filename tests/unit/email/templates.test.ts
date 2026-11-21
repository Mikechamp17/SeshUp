import { describe, expect, it } from "vitest";
import { TEMPLATE_NAMES, renderEmail, type EmailData } from "@/lib/email/templates";
import { createResendSender } from "@/lib/email/send";

const data: EmailData = {
  gymName: "Pilot Gym",
  className: "Boxing Basics",
  startsAt: "2026-11-23T16:00:00Z",
  timezone: "Africa/Johannesburg",
  amountCents: 12345,
  newStartsAt: "2026-11-23T17:00:00Z",
  offerEnd: "2026-11-23T14:00:00Z",
  classUrl: "https://seshup.test/g/pilot/classes/1",
};

describe("email templates", () => {
  it("renders every template with the class time in the gym's zone", () => {
    for (const name of TEMPLATE_NAMES) {
      const { subject, html } = renderEmail(name, data);
      expect(subject.length).toBeGreaterThan(0);
      expect(html).toContain("Pilot Gym");
    }
    expect(renderEmail("booking_confirmed", data).html).toContain("Mon 23 Nov, 18:00");
  });

  it("shows amounts in rand", () => {
    expect(renderEmail("booking_confirmed", data).html).toContain("R123.45");
    expect(renderEmail("late_payment_refund", data).html).toContain("R123.45");
  });

  it("shows the new time and the held-until time", () => {
    expect(renderEmail("class_time_changed", data).html).toContain("Mon 23 Nov, 19:00");
    expect(renderEmail("waitlist_offer", data).html).toContain("Mon 23 Nov, 16:00");
  });

  it("escapes gym and class names so they cannot inject markup", () => {
    const { html } = renderEmail("booking_confirmed", { ...data, gymName: "<script>alert(1)</script>", className: "A & B" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B");
  });
});

describe("Resend sender", () => {
  it("posts the email with the API key and throws when Resend refuses", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = createResendSender({
      apiKey: "re_key",
      from: "SeshUp <no-reply@seshup.test>",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response("{}", { status: 200 });
      },
    });
    await ok.send({ to: "a@x.test", subject: "Hi", html: "<p>Hi</p>" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer re_key");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ to: "a@x.test", subject: "Hi" });

    const refused = createResendSender({
      apiKey: "k",
      from: "f",
      fetchImpl: async () => new Response("bad", { status: 422 }),
    });
    await expect(refused.send({ to: "a@x.test", subject: "s", html: "h" })).rejects.toThrow(/422/);
  });
});
