import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BellRing, Coins, Download, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { toast } from "~/components/ui/toaster";
import { triggerDownload } from "~/lib/download";
import { EMPTY_VALUE, formatCurrency, formatDate, formatDateTime } from "~/lib/format";
import { memberRef } from "~/lib/member-ref";
import { orpc } from "~/lib/orpc";
import { sepaReturnReasonLabel } from "~/lib/sepa-reason";

export const Route = createFileRoute("/app/beitrag/$id")({
  component: FeeRunDetailPage,
});

function FeeRunDetailPage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => orpc.auth.me() });
  const canEdit = me.data?.role === "vorstand" || me.data?.role === "admin";
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const detail = useQuery({
    queryKey: ["feeRuns.get", id],
    queryFn: () => orpc.feeRuns.get({ id }),
  });

  const cancel = useMutation({
    mutationFn: () => orpc.feeRuns.cancel({ id, reason: cancelReason.trim() || null }),
    onSuccess: () => {
      setCancelOpen(false);
      qc.invalidateQueries({ queryKey: ["feeRuns.get", id] });
      qc.invalidateQueries({ queryKey: ["feeRuns.list"] });
    },
  });

  if (detail.isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" /> Lädt…
      </div>
    );
  }
  if (!detail.data) {
    return <div className="text-sm text-muted-foreground">Nicht gefunden.</div>;
  }

  const r = detail.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => nav({ to: "/app/beitrag" })}
            className="self-start text-xs text-muted-foreground hover:text-foreground"
          >
            ← Übersicht
          </button>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Coins className="size-6 text-brand" /> Beitragslauf {r.billingYear}
          </h1>
          <div className="text-sm text-muted-foreground">
            Fällig am {formatDate(r.falligkeitsdatum)} · {r.itemCount} Posten ·{" "}
            {formatCurrency(r.totalAmount)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={r.status} />
          {r.hasXml && r.xmlFilename && canEdit ? (
            <Button
              variant="outline"
              onClick={async () => {
                const res = await orpc.feeRuns.downloadXml({ id });
                triggerDownload(
                  res.filename ?? r.xmlFilename ?? "lauf.xml",
                  res.content,
                  "application/xml",
                );
              }}
            >
              <Download className="size-4" /> pain.008
            </Button>
          ) : null}
          {canEdit && r.status === "committed" ? (
            <Button variant="destructive" onClick={() => setCancelOpen(true)}>
              Stornieren
            </Button>
          ) : null}
        </div>
      </div>

      {cancelOpen ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-base">Lauf wirklich stornieren?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Setzt den Status auf 'storniert'. Alle Soll-Stellungen werden ebenfalls storniert.
                Sie können danach einen neuen Lauf für {r.billingYear} erzeugen.
              </p>
              <input
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="Begründung (optional)"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setCancelOpen(false)}>
                  Abbrechen
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                >
                  {cancel.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <XCircle className="size-4" />
                  )}
                  Stornieren
                </Button>
              </div>
              {cancel.error ? (
                <div className="text-sm text-destructive">{(cancel.error as Error).message}</div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <InfoTile label="Erstellt am" value={formatDateTime(r.createdAt)} />
        <InfoTile
          label="Bestätigt am"
          value={r.committedAt ? formatDateTime(r.committedAt) : EMPTY_VALUE}
        />
        <InfoTile label="Nachrichten-ID" value={r.xmlMessageId ?? EMPTY_VALUE} mono />
      </div>

      {r.status === "committed" && canEdit ? <PrenotificationCard id={id} /> : null}

      {r.notes ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notizen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="whitespace-pre-wrap text-sm text-muted-foreground">{r.notes}</div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Posten ({r.items.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Mitglied</th>
                  <th className="px-4 py-3 font-medium">Art</th>
                  <th className="px-4 py-3 text-right font-medium">Betrag</th>
                  <th className="px-4 py-3 font-medium">Mandat</th>
                  <th className="px-4 py-3 font-medium">IBAN</th>
                  <th className="px-4 py-3 font-medium">Sequenz</th>
                  <th className="px-4 py-3 font-medium">Retoure</th>
                </tr>
              </thead>
              <tbody>
                {r.items.map((it) => (
                  <tr key={it.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2">
                      <Link
                        to="/app/mitglieder/$mitgliedsnummer"
                        params={{ mitgliedsnummer: memberRef(it) }}
                        className="font-medium hover:underline"
                      >
                        {it.memberName}
                      </Link>
                      <div className="text-xs text-muted-foreground">#{memberRef(it)}</div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{it.artName || EMPTY_VALUE}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatCurrency(it.amount)}
                      {it.includesAufnahmegebuhr ? (
                        <div className="text-xs text-muted-foreground">inkl. Aufnahmegebühr</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{it.mandateRef}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      ****{it.debtorIbanLast4}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="secondary">{it.sequenceType}</Badge>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {it.returnedAt ? (
                        <span
                          className="text-destructive"
                          title={sepaReturnReasonLabel(it.returnReasonCode) ?? undefined}
                        >
                          {it.returnReasonCode ?? "Rückläufer"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{EMPTY_VALUE}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PrenotificationCard({ id }: { id: string }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const info = useQuery({
    queryKey: ["feeRuns.prenotifyInfo", id],
    queryFn: () => orpc.feeRuns.prenotifyInfo({ id }),
  });
  const send = useMutation({
    mutationFn: () => orpc.feeRuns.sendPrenotifications({ id }),
    onSuccess: async (r) => {
      setConfirm(false);
      toast.success(
        `Vorabankündigung versendet: ${r.sent} zugestellt${r.failed > 0 ? `, ${r.failed} fehlgeschlagen` : ""}${r.skipped > 0 ? `, ${r.skipped} ohne E-Mail` : ""}.`,
      );
      await qc.invalidateQueries({ queryKey: ["feeRuns.prenotifyInfo", id] });
    },
    onError: (e: Error) => {
      setConfirm(false);
      toast.error("Versand fehlgeschlagen", { description: e.message });
    },
  });

  const withEmail = info.data?.withEmail ?? 0;
  const prenotifiedAt = info.data?.prenotifiedAt ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4 text-brand" /> SEPA-Vorabankündigung
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Kündigt jedem Zahler den Einzug per E-Mail an (Betrag, Fälligkeit, Mandatsreferenz).
          Pflicht vor dem Einzug.
        </p>
        <div className="text-sm">
          <span className="font-semibold tabular-nums">{withEmail}</span> Zahler per E-Mail
          erreichbar
          {info.data && info.data.withoutEmail > 0 ? (
            <span className="text-muted-foreground"> · {info.data.withoutEmail} ohne E-Mail</span>
          ) : null}
        </div>
        {prenotifiedAt ? (
          <div className="text-xs text-muted-foreground">
            Zuletzt versendet am {formatDateTime(prenotifiedAt)}
          </div>
        ) : null}
        <div>
          <Button
            type="button"
            variant={prenotifiedAt ? "outline" : "default"}
            onClick={() => setConfirm(true)}
            disabled={send.isPending || withEmail === 0}
          >
            {send.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <BellRing className="size-4" />
            )}
            {prenotifiedAt ? "Erneut senden" : "Vorabankündigung senden"}
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => {
          if (!send.isPending) setConfirm(o);
        }}
        title="Vorabankündigung senden"
        description={`Die Vorabankündigung geht an ${withEmail} Zahler per E-Mail. Fortfahren?`}
        confirmLabel="Senden"
        loading={send.isPending}
        onConfirm={() => send.mutate()}
      />
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    draft: { label: "Entwurf", variant: "secondary" },
    committed: { label: "Erzeugt", variant: "default" },
    submitted: { label: "Übermittelt", variant: "default" },
    cancelled: { label: "Storniert", variant: "destructive" },
  };
  const cfg = map[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function InfoTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`mt-1 text-sm ${mono ? "font-mono break-all" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
