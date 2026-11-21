export function withParams(path: string, params: Record<string, string>): string {
  return `${path}?${new URLSearchParams(params).toString()}`;
}

/** Text from a form field, trimmed. Empty when the field is missing or not text. */
export function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Finds the message for the first error code contained in an error message. */
export function lookupMessage(table: Record<string, string>, message: string, fallback: string): string {
  for (const [code, text] of Object.entries(table)) {
    if (message.includes(code)) return text;
  }
  return fallback;
}
