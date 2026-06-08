import { useMutation } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { toast } from "~/components/ui/toaster";
import { cn } from "~/lib/cn";
import { orpc } from "~/lib/orpc";

type Member = {
  id: string;
  status: string | null;
  deletedAt: string | Date | null;
};

/**
 * Inline Schnellbearbeitung in the member list: switch a live member between
 * aktiv/passiv and drop them into an Abteilung without opening the detail page.
 * Members that are deleted, ausgetreten or verstorben stay a static badge --
 * those transitions need dates and run through their own dialogs.
 */
export function InlineStatusEdit({
  member,
  canEdit,
  abteilungen,
  onChanged,
}: {
  member: Member;
  canEdit: boolean;
  abteilungen: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);

  const live = member.status === "aktiv" || member.status === "passiv";
  const editable = canEdit && live && !member.deletedAt;

  const mutate = useMutation({
    mutationFn: (
      action:
        | { type: "setAktivPasiv"; value: "A" | "P" }
        | { type: "addAbteilung"; abteilungId: string },
    ) => orpc.members.bulk({ memberIds: [member.id], action }),
    onSuccess: (res) => {
      setOpen(false);
      if (res.changed > 0) {
        onChanged();
        toast.success("Aktualisiert");
      } else {
        toast.info("Keine Änderung");
      }
    },
    onError: (e: Error) => {
      setOpen(false);
      toast.error("Aktion fehlgeschlagen", { description: e.message });
    },
  });

  if (!editable) {
    return <StaticBadge member={member} />;
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        title="Status schnell ändern"
      >
        <StaticBadge member={member} />
        {mutate.isPending ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3 text-muted-foreground" />
        )}
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Schließen"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 z-50 mt-1 w-52 rounded-lg border border-border bg-popover p-1 shadow-elevated">
            <MenuItem
              label="Aktiv"
              active={member.status === "aktiv"}
              onClick={() => mutate.mutate({ type: "setAktivPasiv", value: "A" })}
            />
            <MenuItem
              label="Passiv"
              active={member.status === "passiv"}
              onClick={() => mutate.mutate({ type: "setAktivPasiv", value: "P" })}
            />
            {abteilungen.length > 0 ? (
              <>
                <div className="my-1 h-px bg-border" />
                <div className="px-2 pb-1 pt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Abteilung hinzufügen
                </div>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      mutate.mutate({ type: "addAbteilung", abteilungId: e.target.value });
                    }
                  }}
                  className="mx-1 mb-1 h-8 w-[calc(100%-0.5rem)] rounded-md border border-input bg-card px-2 text-sm"
                >
                  <option value="">Auswählen…</option>
                  {abteilungen.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MenuItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
    >
      <Check className={cn("size-3.5", active ? "text-brand" : "invisible")} />
      {label}
    </button>
  );
}

function StaticBadge({ member }: { member: Member }) {
  if (member.deletedAt) return <Badge variant="destructive">Gelöscht</Badge>;
  if (member.status === "verstorben") return <Badge variant="secondary">Verstorben</Badge>;
  if (member.status === "ausgetreten") return <Badge variant="warning">Ausgetreten</Badge>;
  if (member.status === "passiv") return <Badge variant="secondary">Passiv</Badge>;
  return <Badge variant="success">Aktiv</Badge>;
}
