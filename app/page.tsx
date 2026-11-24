import { Topbar } from "./ui";

export default function Home() {
  return (
    <div className="app">
      <Topbar name="SeshUp" />
      <main className="app-body pad">
        <h1 className="t-h1">Book a class</h1>
        <p className="t-body" style={{ marginTop: 8 }}>Open your gym&apos;s link to see its class timetable.</p>
      </main>
    </div>
  );
}
