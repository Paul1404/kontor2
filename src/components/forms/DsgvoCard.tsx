import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileLock2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { toast } from "~/components/ui/toaster";
import { triggerDownload, triggerDownloadBase64 } from "~/lib/download";
import { orpc } from "~/lib/orpc";

const CONSENT_OPTIONS = [
  { value: "datenverarbeitung", label: "Datenverarbeitung" },
  { value: "foto_name", label: "Foto & Name (Veröffentlichung)" },
  { value: "newsletter", label: "Newsletter" },
  { value: "vereinszeitung", label: "Vereinszeitung" },
] as const;

type ConsentType = (typeof CONSENT_OPTIONS)[number]["value"];

export function DsgvoCard({
  memberId,
  memberSlug,
  canManage,
  isAdmin,
}: {
  memberId: string;
  memberSlug: string;
  canManage: boolean;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const [showErasure, setShowErasure] = useState(false);
  const [showConsent, setShowConsent] = useState(false);

  const consent = useQuery({
    queryKey: ["dsgvo.consent", memberId],
    queryFn: () => orpc.dsgvo.getConsentState({ memberId }),
  });

  const auskunft = useMutation({
    mutationFn: () => orpc.dsgvo.createAuskunftRequest({ memberId, notes: "" }),
    onSuccess: (res) => {
      triggerDownload(res.json.filename, res.json.content, "application/json");
      triggerDownloadBase64(res.pdf.filename, res.pdf.base64, "application/pdf");
      toast.success("DSGVO-Auskunft erstellt", {
        description: `SHA-256: ${res.sha256.slice(0, 12)}…`,
      });
      qc.invalidateQueries({ queryKey: ["dsgvo.list"] });
    },
    onError: (err) =>
      toast.error("Auskunft fehlgeschlagen", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <FileLock2 className="size-4" /> Datenschutz
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => auskunft.mutate()}
            disabled={auskunft.isPending || !canManage}
          >
            {auskunft.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Auskunft Art. 15 erstellen
          </Button>
          {isAdmin ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowErasure((v) => !v)}
            >
              <ShieldAlert className="size-4" />
              Löschung Art. 17
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowConsent((v) => !v)}
            disabled={!canManage}
          >
            <ShieldCheck className="size-4" /> Einwilligungen
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Die Auskunft umfasst alle gespeicherten Stamm-, Vertrags-, SEPA-, Dokument- und
          Einwilligungsdaten zu diesem Mitglied. Anlagen-Downloadlinks sind 24 Stunden gültig.
        </p>

        {showConsent ? (
          <div className="rounded-lg border border-border p-3">
            <ConsentSection
              memberId={memberId}
              current={consent.data?.current ?? []}
              canManage={canManage}
            />
          </div>
        ) : null}

        {showErasure && isAdmin ? (
          <div className="rounded-lg border border-border p-3">
            <ErasureSection memberId={memberId} memberSlug={memberSlug} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ConsentSection({
  memberId,
  current,
  canManage,
}: {
  memberId: string;
  current: Array<{ consentType: string; granted: boolean; recordedAt: Date | string; evidence: string | null }>;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [consentType, setConsentType] = useState<ConsentType>("datenverarbeitung");
  const [granted, setGranted] = useState(true);
  const [evidence, setEvidence] = useState("");

  const record = useMutation({
    mutationFn: () =>
      orpc.dsgvo.recordConsent({ memberId, consentType, granted, evidence }),
    onSuccess: async () => {
      setEvidence("");
      await qc.invalidateQueries({ queryKey: ["dsgvo.consent", memberId] });
      toast.success("Einwilligung erfasst");
    },
    onError: (err) =>
      toast.error("Speichern fehlgeschlagen", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">Aktueller Stand</div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {CONSENT_OPTIONS.map((opt) => {
            const cur = current.find((c) => c.consentType === opt.value);
            return (
              <tr key={opt.value}>
                <td className="py-2">{opt.label}</td>
                <td className="py-2 text-right">
                  {cur ? (
                    cur.granted ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 className="size-4" /> Erteilt
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <XCircle className="size-4" /> Widerrufen
                      </span>
                    )
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2 pl-3 text-xs text-muted-foreground">
                  {cur ? new Date(cur.recordedAt).toLocaleDateString("de-DE") : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {canManage ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            Neue Einwilligung eintragen
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <select
              value={consentType}
              onChange={(e) => setConsentType(e.target.value as ConsentType)}
              className="h-9 rounded-md border border-input bg-card px-2 text-sm shadow-soft"
            >
              {CONSENT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={granted}
                onChange={(e) => setGranted(e.target.checked)}
              />
              Erteilt
            </label>
            <input
              type="text"
              placeholder="Beleg (z.B. Unterschrift Beitrittsformular 12.03.2024)"
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              className="h-9 flex-1 min-w-[200px] rounded-md border border-input bg-card px-2 text-sm shadow-soft"
            />
            <Button
              size="sm"
              onClick={() => record.mutate()}
              disabled={record.isPending}
            >
              {record.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Speichern
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ErasureSection({
  memberId,
  memberSlug,
}: {
  memberId: string;
  memberSlug: string;
}) {
  const qc = useQueryClient();
  const [forceOverride, setForceOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const preview = useQuery({
    queryKey: ["dsgvo.previewErasure", memberId],
    queryFn: () => orpc.dsgvo.previewErasure({ memberId }),
  });

  const execute = useMutation({
    mutationFn: () =>
      orpc.dsgvo.executeErasure({
        memberId,
        requestId: null,
        forceOverride,
        overrideReason,
      }),
    onSuccess: async () => {
      toast.success("Personenbezogene Daten gelöscht (pseudonymisiert)");
      await qc.invalidateQueries({ queryKey: ["members.get", memberSlug] });
      await qc.invalidateQueries({ queryKey: ["dsgvo.previewErasure", memberId] });
    },
    onError: (err) =>
      toast.error("Löschung fehlgeschlagen", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  if (preview.isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        <Loader2 className="inline size-4 animate-spin" /> Vorschau wird berechnet…
      </div>
    );
  }
  if (!preview.data) {
    return <div className="text-sm text-destructive">Vorschau nicht verfügbar.</div>;
  }

  const { diff, retention } = preview.data;
  const expired = retention.retentionExpired;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 size-4 text-amber-500" />
        <div>
          Pseudonymisierung gemäß Art. 17 DSGVO. Finanzdaten bleiben aus steuerlichen Gründen
          (§147 AO, 10 Jahre) bestehen, alle identifizierenden Felder werden überschrieben oder
          geleert.
        </div>
      </div>

      <div className="rounded border border-border bg-muted/40 p-2 text-xs">
        <div>
          Letztes finanzwirksames Ereignis:{" "}
          {retention.lastFinancialEventAt
            ? new Date(retention.lastFinancialEventAt).toLocaleDateString("de-DE")
            : "keines"}
        </div>
        <div>
          Frühester Löschtermin:{" "}
          <span className={expired ? "text-success" : "text-amber-600"}>
            {new Date(retention.earliestErasureDate).toLocaleDateString("de-DE")}
          </span>
        </div>
      </div>

      <div className="max-h-64 overflow-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2 py-1 font-medium">Feld</th>
              <th className="px-2 py-1 font-medium">Vorher</th>
              <th className="px-2 py-1 font-medium">Nachher</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {diff.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-2 py-3 text-center text-muted-foreground">
                  Keine zu löschenden Daten vorhanden — Mitglied bereits anonymisiert.
                </td>
              </tr>
            ) : (
              diff.map((d) => (
                <tr key={d.column}>
                  <td className="px-2 py-1 font-mono">{d.column}</td>
                  <td className="px-2 py-1 text-muted-foreground line-through">
                    {d.before ?? "—"}
                  </td>
                  <td className="px-2 py-1 text-foreground">{d.after ?? "(null)"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!expired ? (
        <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs dark:bg-amber-900/20">
          <label className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
            <input
              type="checkbox"
              checked={forceOverride}
              onChange={(e) => setForceOverride(e.target.checked)}
            />
            Aufbewahrungsfrist trotzdem überschreiben
          </label>
          {forceOverride ? (
            <textarea
              placeholder="Begründung (verpflichtend für Audit-Log)…"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              className="min-h-[60px] rounded border border-input bg-card p-2 text-sm"
            />
          ) : null}
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        Ich habe die Vorschau geprüft und bestätige die Löschung.
      </label>

      <Button
        variant="destructive"
        onClick={() => execute.mutate()}
        disabled={
          execute.isPending ||
          !confirmed ||
          diff.length === 0 ||
          (!expired && (!forceOverride || !overrideReason.trim()))
        }
      >
        {execute.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
        Endgültig pseudonymisieren
      </Button>
    </div>
  );
}
