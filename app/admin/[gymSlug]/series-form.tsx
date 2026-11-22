import { LEVELS } from "@/lib/booking/schedule";
import { styles } from "../styles";

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
    <form action={props.action} style={styles.form}>
      <input type="hidden" name="slug" value={props.slug} />
      {props.seriesId ? <input type="hidden" name="seriesId" value={props.seriesId} /> : null}
      <label style={styles.label}>
        Class name
        <input name="name" defaultValue={d.name} required style={styles.input} />
      </label>
      <label style={styles.label}>
        Description
        <textarea name="description" defaultValue={d.description} rows={3} style={styles.input} />
      </label>
      <label style={styles.label}>
        Level
        <select name="level" defaultValue={d.level} style={styles.input}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </label>
      <label style={styles.label}>
        Coach
        <select name="coachId" defaultValue={d.coachId} style={styles.input}>
          <option value="">No coach</option>
          {props.coaches.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <fieldset style={{ ...styles.input, border: "1px solid #888" }}>
        <legend>Repeats weekly on</legend>
        <div style={styles.row}>
          {DAYS.map(([n, label]) => (
            <label key={n} style={{ display: "flex", gap: 4 }}>
              <input type="checkbox" name="weekdays" value={n} defaultChecked={d.weekdays.includes(n)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label style={styles.label}>
        Start time (gym time)
        <input name="startTime" type="time" defaultValue={d.startTime} required style={styles.input} />
      </label>
      <label style={styles.label}>
        Length (minutes)
        <input name="length" type="number" min={1} defaultValue={d.lengthMinutes} required style={styles.input} />
      </label>
      <label style={styles.label}>
        Spots
        <input name="spotLimit" type="number" min={1} defaultValue={d.spotLimit} required style={styles.input} />
      </label>
      <label style={styles.label}>
        Price (rand)
        <input name="price" type="number" min={1} step="0.01" defaultValue={d.priceRand} required style={styles.input} />
      </label>
      <label style={styles.label}>
        Free cancellation until (hours before start)
        <input name="cutoffHours" type="number" min={0} defaultValue={d.cutoffHours} style={styles.input} />
      </label>
      <button type="submit" style={styles.button}>{props.submitLabel}</button>
    </form>
  );
}
