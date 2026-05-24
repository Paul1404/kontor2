import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { toast } from "~/components/ui/toaster";
import { cn } from "~/lib/cn";

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string | null | undefined;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const trimmed = (value ?? "").trim();
    if (!trimmed) return;
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      toast.error("Zwischenablage nicht verfügbar");
      return;
    }
    navigator.clipboard
      .writeText(trimmed)
      .then(() => {
        setCopied(true);
        toast.success(label ? `${label} kopiert` : "Kopiert");
        window.setTimeout(() => setCopied(false), 1_500);
      })
      .catch(() => toast.error("Kopieren fehlgeschlagen"));
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-6", className)}
      onClick={onClick}
      aria-label={
        label ? `${label} in die Zwischenablage kopieren` : "In die Zwischenablage kopieren"
      }
      title={label ? `${label} kopieren` : "Kopieren"}
    >
      {copied ? (
        <Check className="size-3.5 text-success" />
      ) : (
        <Copy className="size-3.5 text-muted-foreground" />
      )}
    </Button>
  );
}
