import { Alert } from "../ui";

/** Shows the result or error an owner action redirected back with. */
export function Banner({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;
  return (
    <div className="form-stack" style={{ marginBottom: 16 }}>
      {error ? <Alert kind="error" role="alert" title="Could not do that">{error}</Alert> : null}
      {message ? <Alert kind="ok" role="status">{message}</Alert> : null}
    </div>
  );
}
