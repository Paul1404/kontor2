import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Crown, Loader2, Plus, UserMinus, UsersRound, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { toast } from "~/components/ui/toaster";
import { orpc } from "~/lib/orpc";

const ROLLE_LABEL: Record<string, string> = {
  zahler: "Zahler",
  partner: "Partner",
  kind: "Kind",
  sorgeberechtigt: "Sorgeberechtigt",
  angehoerig: "Familienangehörig",
};

function RolleBadge({ rolle }: { rolle: string }) {
  const variant = rolle === "zahler" ? "default" : rolle === "partner" ? "secondary" : "outline";
  return <Badge variant={variant as never}>{ROLLE_LABEL[rolle] ?? rolle}</Badge>;
}

/**
 * Familienmitgliedschaft eines Mitglieds auf der Detailseite. Lädt ihre Daten
 * selbst (wie EhrungenCard), damit der members.get-Payload nicht wächst.
 * Anlegen, Mitglied aufnehmen und Zugehörigkeit beenden direkt aus der Karte;
 * Umbenennen, Zahlerwechsel und Löschen wohnen auf der Familien-Seite.
 */
export function FamilieCard({
  memberId,
  memberNachname,
  memberGeburtsdatum,
  canEdit,
}: {
  memberId: string;
  memberNachname: string | null;
  memberGeburtsdatum?: string | Date | null;
  canEdit: boolean;
}) {
  const birth = memberGeburtsdatum ? new Date(memberGeburtsdatum) : null;
  const adultDate = new Date();
  adultDate.setFullYear(adultDate.getFullYear() - 18);
  const minor = !!birth && birth > adultDate;
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [endTarget, setEndTarget] = useState<{ id: string; name: string } | null>(null);

  const familie = useQuery({
    queryKey: ["familien.forMember", memberId],
    queryFn: () => orpc.familien.forMember({ memberId }),
  });

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["familien.forMember"] });
  };

  const create = useMutation({
    mutationFn: () =>
      orpc.familien.create({
        name: memberNachname ? `Familie ${memberNachname}` : "Familie",
        zahlerMemberId: minor ? null : memberId,
        mitglieder: [{ memberId, rolle: minor ? "kind" : "zahler" }],
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Familie angelegt");
    },
    onError: (e: Error) => toast.error("Anlegen fehlgeschlagen", { description: e.message }),
  });

  const endMember = useMutation({
    mutationFn: (mitgliedschaftId: string) => orpc.familien.endMember({ mitgliedschaftId }),
    onSuccess: async () => {
      setEndTarget(null);
      await invalidate();
      toast.success("Zugehörigkeit beendet");
    },
    onError: (e: Error) => toast.error("Beenden fehlgeschlagen", { description: e.message }),
  });

  const fam = familie.data;
  const aktive = fam?.mitglieder.filter((m) => m.aktiv) ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <UsersRound className="size-5 text-brand" /> Familie
        </CardTitle>
        {fam && canEdit ? (
          <Button variant="outline" size="sm" onClick={() => setAdding((a) => !a)}>
            {adding ? <X className="size-4" /> : <Plus className="size-4" />}
            {adding ? "Abbrechen" : "Mitglied aufnehmen"}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {familie.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Wird geladen…
          </div>
        ) : !fam ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">
              Dieses Mitglied gehört keiner Familie an.
            </p>
            {canEdit ? (
              <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
                {create.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Familie anlegen
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{fam.name}</span>
              <Link
                to="/app/familien"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Alle Familien
              </Link>
            </div>
            <ul className="flex flex-col divide-y divide-border">
              {aktive.map((m) => (
                <li
                  key={m.mitgliedschaftId}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {fam.zahlerMemberId === m.id ? (
                      <Crown className="size-3.5 shrink-0 text-brand" aria-hidden />
                    ) : null}
                    {m.id === memberId ? (
                      <span className="truncate text-sm font-medium">{m.name}</span>
                    ) : (
                      <Link
                        to="/app/mitglieder/$mitgliedsnummer"
                        params={{ mitgliedsnummer: m.reference }}
                        className="truncate text-sm font-medium text-primary hover:underline"
                      >
                        {m.name}
                      </Link>
                    )}
                    <RolleBadge
                      rolle={
                        fam.zahlerMemberId === m.id
                          ? "zahler"
                          : m.rolle === "zahler"
                            ? "angehoerig"
                            : m.rolle
                      }
                    />
                    {canEdit && fam.zahlerMemberId !== m.id && m.rolle !== "kind" ? (
                      <FamilyPayer familieId={fam.id} memberId={m.id} onDone={invalidate} />
                    ) : null}
                    {m.isGuardian ? <Badge variant="outline">Sorgeberechtigt</Badge> : null}
                    {fam.guardianMemberId === m.id ? (
                      <Badge variant="outline">Empfänger für Kinder</Badge>
                    ) : null}
                    {canEdit && m.rolle !== "kind" ? (
                      <GuardianControl
                        familieId={fam.id}
                        memberId={m.id}
                        isGuardian={m.isGuardian}
                        primary={fam.guardianMemberId === m.id}
                        onDone={invalidate}
                      />
                    ) : null}
                  </div>
                  {canEdit && fam.zahlerMemberId !== m.id ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${m.name} aus der Familie austragen`}
                      onClick={() => setEndTarget({ id: m.mitgliedschaftId, name: m.name })}
                    >
                      <UserMinus className="size-4" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {adding && canEdit ? (
              <AddFamilienMitglied
                familieId={fam.id}
                excludeIds={aktive.map((m) => m.id)}
                onDone={async () => {
                  setAdding(false);
                  await invalidate();
                }}
              />
            ) : null}
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={endTarget !== null}
        onOpenChange={(o) => {
          if (!o && !endMember.isPending) setEndTarget(null);
        }}
        aria-label="Zugehörigkeit beenden"
        title="Zugehörigkeit beenden"
        description={endTarget ? `${endTarget.name} aus der Familie austragen?` : ""}
        confirmLabel="Austragen"
        destructive
        loading={endMember.isPending}
        onConfirm={() => {
          if (endTarget) endMember.mutate(endTarget.id);
        }}
      />
    </Card>
  );
}

function AddFamilienMitglied({
  familieId,
  excludeIds,
  onDone,
}: {
  familieId: string;
  excludeIds: string[];
  onDone: () => void | Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [rolle, setRolle] = useState<"partner" | "kind" | "sorgeberechtigt">("kind");
  const [hits, setHits] = useState<
    Array<{ id: string; vorname: string | null; nachname: string | null; memberNo: string | null }>
  >([]);

  const search = useMutation({
    mutationFn: (query: string) => orpc.relationships.searchTargets({ q: query }),
    onSuccess: (data) => setHits(data.filter((h) => !excludeIds.includes(h.id))),
  });

  const add = useMutation({
    mutationFn: (memberId: string) => orpc.familien.addMember({ familieId, memberId, rolle }),
    onSuccess: async () => {
      toast.success("Aufgenommen");
      await onDone();
    },
    onError: (e: Error) => toast.error("Aufnehmen fehlgeschlagen", { description: e.message }),
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (e.target.value.trim().length >= 2) search.mutate(e.target.value.trim());
            else setHits([]);
          }}
          placeholder="Name oder Mitgliedsnummer suchen…"
          aria-label="Mitglied suchen"
        />
        <select
          value={rolle}
          onChange={(e) => setRolle(e.target.value as "partner" | "kind" | "sorgeberechtigt")}
          className="h-10 rounded-lg border border-input bg-card px-2 text-sm"
          aria-label="Rolle"
        >
          <option value="kind">Kind</option>
          <option value="partner">Partner</option>
          <option value="sorgeberechtigt">Sorgeberechtigt</option>
        </select>
      </div>
      {hits.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {hits.slice(0, 8).map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="truncate text-sm">
                {[h.nachname, h.vorname].filter(Boolean).join(", ")}
                {h.memberNo ? (
                  <span className="ml-2 text-xs text-muted-foreground">{h.memberNo}</span>
                ) : null}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => add.mutate(h.id)}
                disabled={add.isPending}
              >
                Aufnehmen
              </Button>
            </li>
          ))}
        </ul>
      ) : q.trim().length >= 2 && !search.isPending ? (
        <p className="text-xs text-muted-foreground">Keine Treffer.</p>
      ) : null}
    </div>
  );
}

function GuardianControl({
  familieId,
  memberId,
  isGuardian,
  primary,
  onDone,
}: {
  familieId: string;
  memberId: string;
  isGuardian: boolean;
  primary: boolean;
  onDone: () => Promise<void>;
}) {
  const change = useMutation({
    mutationFn: (p: { isGuardian: boolean; primary: boolean }) =>
      orpc.familien.setGuardian({ familieId, memberId, ...p }),
    onSuccess: onDone,
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex flex-wrap gap-2">
      <label className="text-xs">
        <input
          type="checkbox"
          checked={isGuardian}
          disabled={change.isPending}
          onChange={(e) =>
            change.mutate({ isGuardian: e.target.checked, primary: primary && e.target.checked })
          }
        />{" "}
        Sorgeberechtigt
      </label>
      <Button
        size="sm"
        variant="ghost"
        disabled={primary || change.isPending}
        onClick={() => change.mutate({ isGuardian: true, primary: true })}
      >
        Empfänger für Kinder
      </Button>
    </div>
  );
}

function FamilyPayer({
  familieId,
  memberId,
  onDone,
}: {
  familieId: string;
  memberId: string;
  onDone: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const save = useMutation({
    mutationFn: () => orpc.familien.update({ id: familieId, patch: { zahlerMemberId: memberId } }),
    onSuccess: async () => {
      setConfirm(false);
      await onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
        Als Familienzahler
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Familienzahler ändern"
        description="Künftige Beiträge der Familienangehörigen verwenden das Konto und Mandat dieser Person. Bereits gestellte Beiträge bleiben erhalten."
        onConfirm={() => save.mutate()}
        loading={save.isPending}
      />
    </>
  );
}
