import { styles } from "./styles";

export function Banner({ error, message }: { error?: string; message?: string }) {
  return (
    <>
      {error ? <p role="alert" style={styles.error}>{error}</p> : null}
      {message ? <p role="status" style={styles.notice}>{message}</p> : null}
    </>
  );
}
