import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, Contact, Loader2, Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AbteilungenCard } from "~/components/forms/AbteilungenCard";
import { AttachmentsCard } from "~/components/forms/AttachmentsCard";
import { BeziehungenCard } from "~/components/forms/BeziehungenCard";
import { ContractsCard } from "~/components/forms/ContractsCard";
import { DsgvoCard } from "~/components/forms/DsgvoCard";
import { SepaCard } from "~/components/forms/SepaCard";
import { SnapshotsTab } from "~/components/snapshots/SnapshotsTab";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { CopyButton } from "~/components/ui/copy-button";
import { toast } from "~/components/ui/toaster";
import { actionLabel, fieldLabel, formatAuditValue, isHiddenField } from "~/lib/audit-labels";
import { triggerDownload } from "~/lib/download";
import { formatLand } from "~/lib/country";
import { formatCurrency, formatDate, formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";
import { usePageShortcut } from "~/lib/use-global-shortcuts";
import { useRecentMembers } from "~/lib/use-recent-members";
import { buildVCard, vcardFilename } from "~/lib/vcard";

export const Route = createFileRoute("/app/mitglieder/$mitgliedsnummer")({
  component: MemberDetailPage,
});

function MemberDetailPage() {
  const { mitgliedsnummer } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: () => orpc.auth.me() });
  const detail = useQuery({
    queryKey: ["members.get", mitgliedsnummer],
    queryFn: () => orpc.members.get({ mitgliedsnummer }),
  });

  const softDelete = useMutation({
    mutationFn: (memberId: string) => orpc.members.softDelete({ memberId }),
    onSuccess: async () => {
      toast.success("Mitglied gelöscht");
      await qc.invalidateQueries({ queryKey: ["members.list"] });
      navigate({ to: "/app/mitglieder", search: () => ({}) as never });
    },
    onError: (err) =>
      toast.error("Löschen fehlgeschlagen", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  const { push: pushRecent } = useRecentMembers();
  const canEdit = me.data?.role === "vorstand" || me.data?.role === "admin";

  usePageShortcut(
    "e",
    canEdit
      ? () =>
          navigate({
            to: "/app/mitglieder/$mitgliedsnummer/bearbeiten",
            params: { mitgliedsnummer },
          })
      : null,
  );

  // Pull the IBAN before the early-return so the hook is called in the
  // same order on every render (rules-of-hooks).
  const memberIban = ((detail.data?.member as Record<string, unknown> | undefined)?.iban1 ??
    null) as string | null;
  const ibanInfo = useIbanBank(memberIban);

  const memberDisplayName = useMemo(() => {
    const m = detail.data?.member;
    if (!m) return "";
    return [m.titel1, m.vorname, m.nachname].filter(Boolean).join(" ");
  }, [detail.data?.member]);

  useEffect(() => {
    if (!detail.data?.member?.mitglnr) return;
    pushRecent({ mitglnr: detail.data.member.mitglnr, name: memberDisplayName });
  }, [detail.data?.member?.mitglnr, memberDisplayName, pushRecent]);

  if (detail.isLoading) return <p className="text-muted-foreground">Wird geladen...</p>;
  if (detail.isError || !detail.data) {
    return <p className="text-destructive">Mitglied nicht gefunden.</p>;
  }

  const { member, abteilungen, vertraege, sepa, anhaenge, audit, beziehungen, sollstellungen } =
    detail.data;

  // Prefer the IBAN-derived bank name/BIC over the stored values — those
  // were free-text in Linear and don't always match the actual BLZ.
  const bankDisplay = ibanInfo?.name ?? member.bank1;
  const bicDisplay = ibanInfo?.bic ?? member.bic1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/app/mitglieder"
            search={() => ({}) as never}
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Zurück zur Liste
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {[member.titel1, member.vorname, member.nachname].filter(Boolean).join(" ")}
          </h1>
          <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            Mitgliedsnummer: <span className="tabular-nums">{member.mitglnr}</span>
            <CopyButton value={member.mitglnr} label="Mitgliedsnummer" />
            <span className="text-muted-foreground/50">·</span>
            <span>AdrNr {member.adrNr}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const vcf = buildVCard({
                vorname: member.vorname,
                nachname: member.nachname,
                titel: member.titel1,
                firma: member.firma1,
                funktion: member.funktion,
                email: member.eMailName,
                telefon: member.telefon1,
                mobil: member.telefon2,
                strasse: member.strasse,
                hausnummer: member.hausnummer,
                plz: member.plz,
                ort: member.ort,
                land: member.land,
                geburtsdatum: member.geburtsdatum,
                website: member.www,
                mitglnr: member.mitglnr,
              });
              triggerDownload(
                vcardFilename({ vorname: member.vorname, nachname: member.nachname, mitglnr: member.mitglnr }),
                vcf,
                "text/vcard;charset=utf-8",
              );
              toast.success("vCard heruntergeladen");
            }}
          >
            <Contact className="size-4" /> Als Kontakt
          </Button>
          {canEdit ? (
            <Link to="/app/mitglieder/$mitgliedsnummer/bearbeiten" params={{ mitgliedsnummer }}>
              <Button variant="outline" size="sm">
                <Pencil className="size-4" /> Bearbeiten
              </Button>
            </Link>
          ) : null}
          {canEdit && confirmDelete ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => softDelete.mutate(member.id)}
                disabled={softDelete.isPending}
              >
                {softDelete.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Wirklich löschen
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={softDelete.isPending}
              >
                Abbrechen
              </Button>
            </>
          ) : canEdit ? (
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4 text-destructive" /> Löschen
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Stammdaten</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Field label="Anrede" value={member.anrede} />
            <Field
              label="Geburtsdatum & Alter"
              value={formatBirthdayWithAge(member.geburtsdatum)}
            />
            <Field label="Geschlecht" value={formatGeschlecht(member.geschlecht)} />
            <Field label="Funktion" value={member.funktion} />
            <Field label="Firma" value={member.firma1} />
            <Field
              label="Adresse"
              value={[
                `${member.strasse ?? ""} ${member.hausnummer ?? ""}`.trim(),
                member.adresszusatz ?? "",
                `${member.plz ?? ""} ${member.ort ?? ""}`.trim(),
              ]
                .filter(Boolean)
                .join("\n")}
              href={buildMapsUrl(member)}
            />
            <Field label="Land" value={formatLand(member.land)} />
            <Field
              label="Telefon"
              value={member.telefon1}
              copyValue={member.telefon1}
              href={buildTelHref(member.telefon1)}
            />
            <Field
              label="Mobil"
              value={member.telefon2}
              copyValue={member.telefon2}
              href={buildTelHref(member.telefon2)}
            />
            <Field
              label="E-Mail"
              value={member.eMailName}
              copyValue={member.eMailName}
              href={buildMailtoHref(member.eMailName)}
            />
            <Field label="Website" value={member.www} href={buildWebsiteHref(member.www)} />
            <Field label="Eintritt" value={formatDate(member.eintritt)} />
            <Field label="Austritt" value={formatDate(member.austritt)} />
            <Field label="Spender" value={member.spender === "J" ? "Ja" : "Nein"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bankverbindung</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Field
              label="IBAN"
              value={formatIbanGrouped(member.iban1)}
              copyValue={member.iban1 ? (member.iban1 as string).replace(/\s+/g, "") : null}
              mono
            />
            <Field label="Bank" value={bankDisplay} />
            <Field label="BIC" value={bicDisplay} copyValue={bicDisplay} mono />
            <Field label="Kontoinhaber" value={member.abwKontoInh} />
            {ibanInfo ? (
              <p className="text-xs text-muted-foreground">
                Bank und BIC werden aus der IBAN abgeleitet (Quelle: Bundesbank BLZ-Verzeichnis).
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {member.notes ? (
        <Card>
          <CardHeader>
            <CardTitle>Notizen</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-sm text-foreground">{member.notes}</p>
          </CardContent>
        </Card>
      ) : null}

      <AbteilungenCard
        memberId={member.id}
        mitgliedsnummer={mitgliedsnummer}
        abteilungen={abteilungen as never}
        canEdit={canEdit}
      />

      <BeziehungenCard
        memberId={member.id}
        mitgliedsnummer={mitgliedsnummer}
        beziehungen={beziehungen as never}
        canEdit={canEdit}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ContractsCard
          memberId={member.id}
          mitgliedsnummer={mitgliedsnummer}
          vertraege={vertraege as never}
          canEdit={canEdit}
        />
        <SepaCard
          memberId={member.id}
          mitgliedsnummer={mitgliedsnummer}
          mandate={sepa as never}
          canEdit={canEdit}
        />
      </div>

      <SollstellungenCard rows={sollstellungen as never} />

      <AttachmentsCard
        memberId={member.id}
        mitgliedsnummer={mitgliedsnummer}
        anhaenge={anhaenge}
        canEdit={canEdit}
      />

      <SnapshotsTab memberId={member.id} mitgliedsnummer={mitgliedsnummer} canRestore={canEdit} />

      <DsgvoCard
        memberId={member.id}
        memberSlug={mitgliedsnummer}
        canManage={canEdit}
        isAdmin={me.data?.role === "admin"}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Audit Log</CardTitle>
          <Link
            to="/app/audit"
            search={{
              q: "",
              actorEmail: "",
              action: "",
              entityType: "member",
              entityId: member.id,
              from: "",
              to: "",
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Vollständige Historie →
          </Link>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Änderungen protokolliert.</p>
          ) : (
            <ul className="flex flex-col divide-y text-sm">
              {audit.map((entry) => (
                <AuditEntry key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function useIbanBank(iban: string | null | undefined): { name: string; bic: string } | null {
  const cleaned = useMemo(() => (iban ? iban.replace(/\s+/g, "").toUpperCase() : ""), [iban]);
  const enabled = cleaned.length >= 12 && cleaned.startsWith("DE");
  const query = useQuery({
    queryKey: ["banks.lookupByIban", cleaned],
    queryFn: () => orpc.banks.lookupByIban({ iban: cleaned }),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (!query.data?.found) return null;
  return { name: query.data.name, bic: query.data.bic };
}

function formatIbanGrouped(iban: string | null | undefined): string {
  if (!iban) return "";
  return iban
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

function buildTelHref(value: string | null | undefined): string | null {
  if (!value) return null;
  // Strip everything except digits and the leading +. Most German phone
  // numbers are stored with spaces and parentheses we need to drop.
  const cleaned = value.replace(/[^\d+]/g, "");
  return cleaned.length >= 3 ? `tel:${cleaned}` : null;
}

function buildMailtoHref(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.includes("@")) return null;
  return `mailto:${trimmed}`;
}

function buildWebsiteHref(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Most stored URLs lack a scheme. Assume https://.
  return `https://${trimmed}`;
}

function buildMapsUrl(
  m: { strasse?: string | null; hausnummer?: string | null; plz?: string | null; ort?: string | null },
): string | null {
  const street = `${m.strasse ?? ""} ${m.hausnummer ?? ""}`.trim();
  const city = `${m.plz ?? ""} ${m.ort ?? ""}`.trim();
  const query = [street, city].filter(Boolean).join(", ");
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function formatBirthdayWithAge(value: string | Date | null | undefined): string {
  if (!value) return "";
  const formatted = formatDate(value);
  if (!formatted) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(d.getTime())) return formatted;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const beforeBirthday =
    now.getMonth() < d.getMonth() ||
    (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
  if (beforeBirthday) age -= 1;
  return `${formatted} · ${age} Jahre`;
}

function formatGeschlecht(value: string | null | undefined): string {
  switch (value) {
    case "m":
      return "Männlich";
    case "w":
      return "Weiblich";
    case "d":
      return "Divers";
    case "unbekannt":
      return "Unbekannt";
    default:
      return "";
  }
}

type SollstellungRow = {
  id: string;
  vertragNr: string;
  artName: string | null;
  billingYear: number;
  falligkeitsdatum: string | Date;
  amount: string;
  paidAmount: string;
  openAmount: string;
  status: string;
};

function SollstellungenCard({ rows }: { rows: SollstellungRow[] }) {
  if (!rows || rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sollstellung</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Keine Sollstellungen vorhanden. Werden beim nächsten Beitragslauf erzeugt.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sollstellung</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Jahr</th>
              <th className="px-4 py-2 font-medium">Vertrag</th>
              <th className="px-4 py-2 font-medium">Art</th>
              <th className="px-4 py-2 font-medium">Fällig</th>
              <th className="px-4 py-2 text-right font-medium">Betrag</th>
              <th className="px-4 py-2 text-right font-medium">Offen</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-4 py-2 tabular-nums">{r.billingYear}</td>
                <td className="px-4 py-2 tabular-nums text-muted-foreground">{r.vertragNr}</td>
                <td className="px-4 py-2">{r.artName ?? "—"}</td>
                <td className="px-4 py-2 tabular-nums text-muted-foreground">
                  {formatDate(r.falligkeitsdatum)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(r.amount)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCurrency(r.openAmount)}
                </td>
                <td className="px-4 py-2">
                  <SollstellungStatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function SollstellungStatusBadge({ status }: { status: string }) {
  const variant: "outline" | "success" | "warning" | "secondary" =
    status === "paid" ? "success" : status === "open" ? "warning" : "secondary";
  const label =
    status === "paid"
      ? "Bezahlt"
      : status === "open"
        ? "Offen"
        : status === "returned"
          ? "Rückläufer"
          : status === "cancelled"
            ? "Storniert"
            : status;
  return <Badge variant={variant}>{label}</Badge>;
}

function Field({
  label,
  value,
  mono,
  copyValue,
  href,
}: {
  label: string;
  value: unknown;
  mono?: boolean;
  copyValue?: string | null;
  href?: string | null;
}) {
  const isEmpty = value == null || value === "";
  const display = isEmpty ? (
    <span className="text-muted-foreground">k.A.</span>
  ) : href ? (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noreferrer noopener" : undefined}
      className="text-foreground underline-offset-4 hover:underline hover:text-primary"
    >
      {String(value)}
    </a>
  ) : (
    <span>{String(value)}</span>
  );
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase text-muted-foreground tracking-wide">{label}</span>
      <span
        className={`flex items-center gap-1 whitespace-pre-line ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {display}
        {!isEmpty && copyValue ? <CopyButton value={copyValue} label={label} /> : null}
      </span>
    </div>
  );
}

type AuditEntryRow = {
  id: string;
  action: string;
  source: string;
  actorEmail: string | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  createdAt: string | Date;
};

function AuditEntry({ entry }: { entry: AuditEntryRow }) {
  const [open, setOpen] = useState(false);
  const visibleChanges = Object.entries(entry.changes ?? {}).filter(([k]) => !isHiddenField(k));
  const summary = visibleChanges
    .slice(0, 3)
    .map(([k]) => fieldLabel(k))
    .join(", ");
  return (
    <li className="py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 text-left hover:bg-muted/30 -mx-2 px-2 py-1 rounded"
      >
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{actionLabel(entry.action)}</Badge>
            <span className="text-sm">
              {visibleChanges.length === 0
                ? "Keine sichtbaren Felder geändert"
                : `${visibleChanges.length} Feld${visibleChanges.length === 1 ? "" : "er"}: ${summary}${visibleChanges.length > 3 ? "…" : ""}`}
            </span>
          </div>
          {entry.actorEmail ? (
            <span className="text-xs text-muted-foreground">{entry.actorEmail}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDateTime(entry.createdAt)}
          </span>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {open && visibleChanges.length > 0 ? (
        <div className="mt-2 overflow-hidden rounded border border-border bg-muted/30">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Feld</th>
                <th className="px-3 py-1.5 font-medium">Vorher</th>
                <th className="px-3 py-1.5 font-medium">Nachher</th>
              </tr>
            </thead>
            <tbody>
              {visibleChanges.map(([k, change]) => (
                <tr key={k} className="border-t border-border/60">
                  <td className="px-3 py-1.5 font-medium">{fieldLabel(k)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {formatAuditValue(k, change.before)}
                  </td>
                  <td className="px-3 py-1.5">{formatAuditValue(k, change.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </li>
  );
}
