import * as v from "valibot";

const optionalLine = (max: number) =>
  v.optional(v.pipe(v.string(), v.trim(), v.maxLength(max), v.regex(/^[^\r\n]*$/)), "");

/** Per-letter overrides only. Blank fields retain the club defaults. */
export const manualLetterOptionsSchema = v.object({
  senderName: optionalLine(100),
  senderTitle: optionalLine(100),
  contact: optionalLine(160),
  returnAddress: optionalLine(180),
  letterDate: v.optional(
    v.pipe(
      v.string(),
      v.isoDate(),
      v.check((value) => {
        const date = new Date(`${value}T12:00:00Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
      }, "Bitte ein gültiges Briefdatum eingeben."),
    ),
    undefined,
  ),
  signatureSpace: v.optional(v.boolean(), false),
});

export type ManualLetterOptions = v.InferOutput<typeof manualLetterOptionsSchema>;
