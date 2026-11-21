---
title: SeshUp Boxing Gym Class Booking - Plan
type: feat
date: 2026-11-21
topic: boxing-gym-class-booking
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# SeshUp Boxing Gym Class Booking - Plan

## Goal Capsule

- **Objective:** Members of a boxing gym book and pay for group classes from their phone instead of through WhatsApp, and no class ever goes over its spot limit. This plan covers the first release only: group classes on a mobile web link, run for one pilot gym on a system that can host many gyms.
- **Product authority:** This Product Contract governs the first release. 1-to-1 sessions, open gym slots, and the iPhone and Android apps are later releases and are not active scope here.
- **Open blockers:** None.

---

## Product Contract

### Summary

SeshUp is a booking system for boxing gyms that you sell to many gyms. The first release is a phone-friendly web link where members create an account, see the gym's weekly class timetable, and book and pay for a class by card. Full classes offer a waitlist, cancellations are refunded before an owner-set cutoff, and each owner sets up classes in their own admin area. Payments go to the gym's own account, and SeshUp takes a percentage of each booking.

### Problem Frame

The pilot gym, run by someone you know, takes class bookings through WhatsApp messages. Nothing enforces a spot limit, so classes overfill. The owner spends time reading and answering messages to manage who is coming.

Other boxing gyms have the same problem. General gym software such as Mindbody, Glofox, and TeamUp exists, but these tools are built for every kind of gym and are more complex and more expensive than a small boxing gym needs. SeshUp's position is simpler and cheaper, built around boxing gyms.

<!-- ce-section: work-relationships -->
### How This Work Fits Together

This plan covers the first release: group class booking with card payment on a mobile web link. The breakdown below is the current understanding, not a committed roadmap.

- 1-to-1 sessions with a coach. Depends on this release. Shares the idea of a time slot with a spot limit (one spot) and the same payment and cancellation rules. Brings coach logins so coaches set their own availability.
- Open gym slots. Depends on this release. Shares the same slot, payment, and cancellation rules.
- iPhone and Android apps. Depends on this release. Members use the same accounts and bookings as the web link.
- Class register for attendance and no-shows. Depends on this release. Still to decide when it is built. Likely an early add-on.

### Actors

- A1. Platform operator: you. Creates each gym, sets its fee percentage, and onboards its owner.
- A2. Gym owner: sets up the gym's classes, schedule, coaches, prices, and cancellation cutoffs, and sees who is booked.
- A3. Member: a person who trains at the gym. Books, pays for, and cancels classes.
- A4. Coach: shown on the classes they teach. Has no login in this release.

### Key Decisions

- **Group classes ship first, on a mobile web link.** The pilot gym gets a working system in about 4 to 6 weeks instead of waiting for all booking types and store apps. (session-settled: user-directed, chosen over launching classes, 1-to-1s, open gym, and store apps together: the smallest version that stops WhatsApp bookings and overcrowding.)
- **Members pay per booking by card.** Governs R13, R16, R17. (session-settled: user-directed, chosen over no payments and over memberships or class packs: it was the user's choice.)
- **Members sign in with an account (name, email, password).** Governs R12. (session-settled: user-directed, chosen over phone-number quick-book with text codes: the user preferred familiar accounts.)
- **Refund before an owner-set cutoff, no refund after.** Governs R8, R16. (session-settled: user-approved, chosen over always refund, never refund, and credit instead: discourages last-minute cancellations while staying fair.)
- **Full classes get a notify-then-book waitlist.** Members are never booked or charged without acting. Governs R19, R20. (session-settled: user-approved, chosen over auto-booking from the waitlist and over no waitlist.)
- **You set up each gym yourself.** Gym self-signup comes later. Governs R1. (session-settled: user-approved, chosen over gym self-signup and over a separate installed copy per gym: less to build and you learn from each early customer.)
- **Money goes to the gym's own payment account, and SeshUp takes a percentage of each booking.** Gyms pay nothing upfront. Governs R3, R4. (session-settled: user-directed, chosen over a flat monthly fee and over collecting all payments then paying gyms out.)
- **A full refund returns SeshUp's fee too.** The member gets back everything they paid. Governs R16, R17.
- **The gym absorbs card processing fees kept on a refund.** The gym took the booking, and SeshUp's income stays predictable. Governs R16. (session-settled: user-approved, chosen over SeshUp absorbing it and over deducting it from the member's refund.)
- **The first market is South Africa, with prices in rand (ZAR).** The pilot gym is there. Governs R3, R5.
- **Email is the only notification channel in this release.** Members sign up with email, so no text message cost is needed yet. Governs R21.

### Requirements

**Gyms and the platform**

- R1. The platform operator creates each gym, sets its name, and sets its SeshUp fee percentage.
- R2. Each gym's classes, members, bookings, and payments are kept fully separate from every other gym.
- R3. A gym connects its own card payment account before members can book its classes, and member payments go directly to that account.
- R4. SeshUp's fee percentage for the gym is taken automatically from each booking payment.

**Owner admin area**

- R5. The owner creates a class with a name, description, start time, length, spot limit, and price.
- R6. The owner sets a class to repeat weekly on chosen days, and can change or cancel a single date without affecting the other dates.
- R7. The owner adds coaches by name and assigns one coach to each class.
- R8. The owner sets the cancellation cutoff for each class, with a default of 12 hours before the start.
- R9. The owner marks each class with a level label: Beginner, Intermediate, Advanced, or Sparring. The label is shown to members and does not restrict who can book.
- R10. The owner sees, for each class date, who is booked, how many spots are left, and who is on the waitlist.

**Member booking**

- R11. Anyone with the gym's link sees its weekly timetable on a phone, with each class's time, coach, level, price, and spots left, without signing in.
- R12. A member creates an account with name, email, and password before their first booking, and signs in for later bookings.
- R13. A member books one spot for themselves in a class and pays by card at the time of booking. The spot is confirmed only when the payment succeeds.
- R14. A class never has more confirmed bookings than its spot limit, including when several members try to book the last spot at the same moment.
- R15. A member sees their upcoming bookings and can cancel any of them.

**Cancellations and refunds**

- R16. When a member cancels before the class's cutoff, they get a full refund of everything they paid, including SeshUp's fee. Any processing fee the card provider keeps is charged to the gym. When they cancel after the cutoff, the booking is cancelled and the spot is freed, with no refund.
- R17. When the owner cancels a class date, every member booked on it gets a full refund, whatever the cutoff.

**Waitlist**

- R18. When a class is full, a member can join its waitlist. Waitlist places are in the order members joined.
- R19. When a spot opens, the first member on the waitlist is emailed an offer and the spot is held for them for a set time. If they do not book and pay in that time, the offer passes to the next member.
- R20. A member on the waitlist is never booked or charged unless they book and pay themselves.

**Notifications**

- R21. Members get an email for each booking confirmation, cancellation, refund, owner-cancelled class, and waitlist offer.

### Key Flows

- F1. Member books a class for the first time
  - **Trigger:** A member taps the gym's link in the gym's WhatsApp group.
  - **Actors:** A3
  - **Steps:** Sees the week's timetable. Picks a class with spots left. Creates an account. Pays by card. Gets a confirmation email.
  - **Outcome:** The member has a confirmed spot and the class's spots-left count drops by one.
  - **Covered by:** R11, R12, R13, R14, R21

- F2. Member cancels a booking
  - **Trigger:** A member can no longer attend.
  - **Actors:** A3
  - **Steps:** Opens their upcoming bookings. Cancels the class. Gets a refund or not, per R16. Gets an email.
  - **Outcome:** The spot is freed and the waitlist offer starts, per R19.
  - **Covered by:** R15, R16, R19, R21

- F3. Waitlisted member gets a spot
  - **Trigger:** A spot opens in a full class.
  - **Actors:** A3
  - **Steps:** The first member on the waitlist gets an offer email. They book and pay within the hold time, or the offer passes on.
  - **Outcome:** The spot is filled by someone who chose to book, and nobody is charged without acting.
  - **Covered by:** R18, R19, R20, R21

- F4. Owner sets up the timetable
  - **Trigger:** A new gym goes live, or the owner adds a class.
  - **Actors:** A2
  - **Steps:** Adds coaches. Creates each class with its details, level, cutoff, and weekly repeat. Shares the gym's link in WhatsApp.
  - **Outcome:** Members see and book the timetable.
  - **Covered by:** R5, R6, R7, R8, R9

- F5. Operator onboards a new gym
  - **Trigger:** A gym agrees to use SeshUp.
  - **Actors:** A1, A2
  - **Steps:** The operator creates the gym and sets its fee percentage. The owner connects the gym's payment account and sets up the timetable, per F4.
  - **Outcome:** The gym can take paid bookings.
  - **Covered by:** R1, R3, R4

### Acceptance Examples

- AE1. **Covers R14.** Given a class with 12 spots and 11 confirmed bookings, when two members try to book at the same moment, then exactly one gets the spot and the other is offered the waitlist.
- AE2. **Covers R16.** Given a 12-hour cutoff on a Monday 6pm class, when a member cancels at 5am Monday, then they get a full refund. When they cancel at 7am Monday, then their spot is freed and they get no refund.
- AE3. **Covers R17.** Given the owner cancels Wednesday's class 2 hours before it starts, when the class had 10 booked members, then all 10 get a full refund and an email.
- AE4. **Covers R19, R20.** Given a full class with 3 members on the waitlist, when a booked member cancels, then only the first waitlisted member gets an offer. If they do nothing during the hold time, the second member gets the offer and the first is not charged.
- AE5. **Covers R6.** Given a class repeating every Monday and Wednesday, when the owner cancels one Wednesday, then only that date is cancelled and all other dates stay bookable.
- AE6. **Covers R4, R16.** Given a SeshUp fee of 5% on a booking, when the member cancels before the cutoff, then the member gets back the full amount they paid, including SeshUp's 5%.

### Success Criteria

- Within 2 months of launch at the pilot gym, no class bookings happen through WhatsApp.
- Within the same period, no class has more people booked than its spot limit.

### Scope Boundaries

**Deferred for later**

- 1-to-1 sessions with coaches, and coach logins.
- Open gym slots.
- iPhone and Android apps.
- A class register for attendance and no-show tracking.
- Restricting who can book a level, such as Sparring.
- A sparring safety waiver and health questions.
- Parents booking for children, and booking for a friend.
- Text message or WhatsApp notifications.
- Gyms signing up and onboarding themselves.
- Memberships, class packs, and credits.

**Outside this product's identity**

- A general-purpose gym management system with marketing, CRM, payroll, and retail features. SeshUp stays simple booking for boxing gyms.
- A WhatsApp chatbot. SeshUp replaces booking by message, it does not automate it.

### Dependencies / Assumptions

- The pilot gym's owner is willing to share the link in their WhatsApp group and ask members to book only through it.
- Members have a card they can pay with online.
- A card payment provider is available in South Africa that pays each gym directly in rand and takes a platform percentage per payment. This is unverified.
- The waitlist hold time in R19 is assumed to be 2 hours, shortened so the offer ends before the class starts. The owner cannot change it in this release.
- SeshUp's position as simpler and cheaper than general gym software is assumed to hold. How it fares if those tools add a cheap simple plan was not tested.

### Outstanding Questions

**Deferred to Planning**

- Which card payment provider to use. It must support South African gyms, rand payouts, a platform percentage per payment, and refunds that charge the gym the processing fee.
- How the web link is structured per gym, such as a gym-specific address.
- How members reset a forgotten password.
