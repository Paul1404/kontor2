import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Download, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { toast } from "~/components/ui/toaster";
import { triggerDownloadBase64 } from "~/lib/download";
import { SONDEREHRUNG_VORSCHLAEGE } from "~/lib/ehrungen";
import { formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

/**
 * Recorded honors (Ehrungen) for one member: list awarded honors, add a new one
 * (a Sonderehrung by title, or a Vereinsjubiläum by entering the years), print
 * the Ehrungsurkunde, and remove a mistaken entry. Reads its own data so it can
 * sit on the member overview without enlarging the member payload.
 */
export function EhrungenCard({ memberId, canEdit }: { memberId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [titel, setTitel] = useState("");
  const [verliehenAm, setVerliehenAm] = useState(() => new Date().toISOString().slice(0, 10));
  const [jahre, setJahre] = useState("");

  const ehrungen = useQuery({
    queryKey: ["ehrungen.forMember", memberId],
    queryFn: () => orpc.ehrungen.forMember({ memberId }),
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["ehrungen.forMember", memberId] }),
      qc.invalidateQueries({ queryKey: ["timeline.forMember", memberId] }),
    ]);
  };

  const create = useMutation({
    mutationFn: () => {
      const j = jahre.trim() ? Number.parseInt(jahre.trim(), 10) : null;
      const kind = j != null ? ("vereinsjubilaeum" as const) : ("sonderehrung" as const);
      return orpc.ehrungen.record({
        memberId,
        kind,
        jubilaeumJahre: j,
        titel: titel.trim(),
        verliehenAm,
      });
    },
    onSuccess: async () => {
      setTitel("");
      setJahre("");
      await invalidate();
      toast.success("Ehrung erfasst");
    },
    onError: (e: Error) => toast.error("Konnte nicht erfasst werden", { description: e.message }),
  });

  const urkunde = useMutation({
    mutationFn: (id: string) => orpc.ehrungen.urkunde({ id }),
    onSuccess: async (r) => {
      triggerDownloadBase64(r.filename, r.base64, "application/pdf");
      await invalidate();
    },
    onError: (e: Error) => toast.error("Urkunde fehlgeschlagen", { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => orpc.ehrungen.remove({ id }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error("Löschen fehlgeschlagen", { description: e.message }),
  });

  const rows = ehrungen.data ?? [];
  const canSubmit = (titel.trim() !== "" || jahre.trim() !== "") && verliehenAm !== "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="size-5 text-brand" /> Ehrungen
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {canEdit ? (
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit && !create.isPending) create.mutate();
            }}
          >
            {/* biome-ignore lint/a11y/noLabelWithoutControl: the label wraps its Input control as children, which the rule does not detect. */}
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Ehrung</span>
              <Input
                value={titel}
                onChange={(e) => setTitel(e.target.value)}
                placeholder="z. B. Goldene Ehrennadel"
                list="ehrung-vorschlaege"
              />
              <datalist id="ehrung-vorschlaege">
                {SONDEREHRUNG_VORSCHLAEGE.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
            {/* biome-ignore lint/a11y/noLabelWithoutControl: the label wraps its Input control as children, which the rule does not detect. */}
            <label className="flex flex-col gap-1 sm:w-28">
              <span className="text-xs font-medium text-muted-foreground">Jubiläum (Jahre)</span>
              <Input
                type="number"
                min={1}
                max={150}
                value={jahre}
                onChange={(e) => setJahre(e.target.value)}
                placeholder="z. B. 25"
              />
            </label>
            {/* biome-ignore lint/a11y/noLabelWithoutControl: the label wraps its Input control as children, which the rule does not detect. */}
            <label className="flex flex-col gap-1 sm:w-40">
              <span className="text-xs font-medium text-muted-foreground">Verliehen am</span>
              <Input
                type="date"
                value={verliehenAm}
                onChange={(e) => setVerliehenAm(e.target.value)}
              />
            </label>
            <Button type="submit" disabled={!canSubmit || create.isPending}>
              {create.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Erfassen
            </Button>
          </form>
        ) : null}

        {canEdit ? (
          <p className="text-xs text-muted-foreground">
            Für ein Vereinsjubiläum die Jahre eintragen (der Titel wird dann automatisch gesetzt).
            Für eine Sonderehrung nur einen Titel angeben.
          </p>
        ) : null}

        {ehrungen.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Lade…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Ehrungen erfasst.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <Award className="size-3.5" />
                </span>
                <div className="flex flex-1 flex-col">
                  <span className="text-sm font-medium">{e.titel}</span>
                  <span className="text-xs text-muted-foreground">
                    verliehen am {formatDate(e.verliehenAm)}
                    {e.urkundeDocRef ? ` · Urkunde ${e.urkundeDocRef}` : ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => urkunde.mutate(e.id)}
                      disabled={urkunde.isPending}
                      title="Ehrenurkunde erzeugen und herunterladen"
                    >
                      {urkunde.isPending && urkunde.variables === e.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Download className="size-4" />
                      )}
                      Urkunde
                    </Button>
                  ) : null}
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => remove.mutate(e.id)}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                      title="Löschen"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
