import { LEVELS } from "@/lib/booking/schedule";

export type SeriesDefaults = {
  name: string;
  description: string;
  level: string;
  coachId: string;
  weekdays: number[];
  startTime: string;
  lengthMinutes: number;
  spotLimit: number;
  priceRand: string;
  cutoffHours: number;
};

export const EMPTY_SERIES: SeriesDefaults = {
  name: "", description: "", level: "Beginner", coachId: "", weekdays: [1], startTime: "18:00",
  lengthMinutes: 60, spotLimit: 12, priceRand: "", cutoffHours: 12,
};

const DAYS: [number, string][] = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];

export function SeriesForm(props: {
  action: (formData: FormData) => Promise<void>;
  slug: string;
  seriesId?: string;
  coaches: { id: string; name: string }[];
  defaults: SeriesDefaults;
  submitLabel: string;
}) {
  const d = props.defaults;
  return (
    <form action={props.action} className="form-stack">
      <input type="hidden" name="slug" value={props.slug} />
      {props.seriesId ? <input type="hidden" name="seriesId" value={props.seriesId} /> : null}
      <div className="field">
        <label htmlFor="name">Class name</label>
        <input id="name" name="name" defaultValue={d.name} required className="input" />
      </div>
      <div className="field">
        <label htmlFor="description">Description</label>
        <textarea id="description" name="description" defaultValue={d.description} rows={3} className="input textarea" />
      </div>
      <div className="field">
        <label htmlFor="level">Level</label>
        <select id="level" name="level" defaultValue={d.level} className="input">
          {LEVELS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="coachId">Coach</label>
        <select id="coachId" name="coachId" defaultValue={d.coachId} className="input">
          <option value="">No coach</option>
          {props.coaches.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <fieldset className="bare">
        <legend>Repeats weekly on</legend>
        <div className="chips">
          {DAYS.map(([n, label]) => (
            <label key={n} className="chip">
              <input type="checkbox" name="weekdays" value={n} defaultChecked={d.weekdays.includes(n)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="startTime">Start time (gym time)</label>
        <input id="startTime" name="startTime" type="time" defaultValue={d.startTime} required className="input" />
      </div>
      <div className="field">
        <label htmlFor="length">Length (minutes)</label>
        <input id="length" name="length" type="number" min={1} defaultValue={d.lengthMinutes} required className="input" />
      </div>
      <div className="field">
        <label htmlFor="spotLimit">Spots</label>
        <input id="spotLimit" name="spotLimit" type="number" min={1} defaultValue={d.spotLimit} required className="input" />
      </div>
      <div className="field">
        <label htmlFor="price">Price (rand)</label>
        <input id="price" name="price" type="number" min={1} step="0.01" defaultValue={d.priceRand} required className="input" />
      </div>
      <div className="field">
        <label htmlFor="cutoffHours">Free cancellation until (hours before start)</label>
        <input id="cutoffHours" name="cutoffHours" type="number" min={0} defaultValue={d.cutoffHours} className="input" />
      </div>
      <button type="submit" className="btn btn-primary btn-block">{props.submitLabel}</button>
    </form>
  );
}
