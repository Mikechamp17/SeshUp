import { styles } from "./styles";

export type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export function Banner({ error, message }: { error?: string; message?: string }) {
  return (
    <>
      {error ? <p role="alert" style={styles.error}>{error}</p> : null}
      {message ? <p role="status" style={styles.notice}>{message}</p> : null}
    </>
  );
}
