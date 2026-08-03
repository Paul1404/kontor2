export function FormFieldError({ errors }: { errors: readonly unknown[] }) {
  const message = errors.find((item): item is string => typeof item === "string");
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}
