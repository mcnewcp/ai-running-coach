import { z } from "zod";

/** A local calendar date input, described for the coach. */
export function date(description: string) {
  return z.string().describe(`${description}: a local calendar date, YYYY-MM-DD`);
}

/** A tool result carrying `output` as structured content, and as JSON text for clients without it. */
export function structured<T extends Record<string, unknown>>(output: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
}
