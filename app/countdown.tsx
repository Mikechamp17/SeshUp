"use client";

import { useEffect, useState } from "react";

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Counts down to the end of a hold or waitlist offer, with a bar that drains. Shows dashes until it has the time. */
export function Countdown({ endsAt, totalSeconds }: { endsAt: string; totalSeconds: number }) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const end = new Date(endsAt).getTime();
    const tick = () => setLeft(Math.max(0, Math.floor((end - Date.now()) / 1000)));
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [endsAt]);

  const percent = left === null ? 0 : Math.min(100, Math.round((left / totalSeconds) * 100));
  return (
    <>
      <div className="countdown" role="timer" aria-label={left === null ? "Time left" : `${clock(left)} left`}>
        {left === null ? "--:--" : clock(left)}
      </div>
      <div className="meter" style={{ marginTop: 12, background: "rgba(15,15,16,.18)" }} aria-hidden="true">
        <i style={{ width: `${percent}%` }} />
      </div>
      {left === 0 ? <p className="t-small" style={{ fontWeight: 700, marginTop: 8 }}>Time is up. Refresh to check if the spot is still yours.</p> : null}
    </>
  );
}
