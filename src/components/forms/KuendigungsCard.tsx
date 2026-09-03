import { useQuery } from "@tanstack/react-query";
import { CalendarClock, FileText, Mail, Paperclip } from "lucide-react";
import { useState } from "react";
import { KuendigungsMailDialog } from "~/components/forms/KuendigungsMailDialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { QueryError } from "~/components/ui/query-error";
import { Skeleton } from "~/components/ui/skeleton";
import { formatDate, formatDateTime, orEmpty } from "~/lib/format";
import { orpc } from "~/lib/orpc";

function modeLabel(mode: string): string {
  if (mode === "year_end") return "nur zum Jahresende";
  if (mode === "month_end") return "nur zum Monatsende";
  return "jederzeit kündbar";
}

/**
 * Paper trail behind a member's Austrittsdatum: when the written
 * Austrittserklärung arrived, the scan itself, and how the Austrittstermin was
 * derived from it. Rendered next to the Austrittsbestätigung so the outgoing
 * letter and the incoming notice sit together.
 */
export function KuendigungsCard({
  memberId,
  austrittDatum,
  canEdit,
}: {
  memberId: string;
  /** The member's Austrittsdatum, if any. Drives the no-receipt fallback. */
  austrittDatum: string | Date | null | undefined;
  canEdit: boolean;
}) {
  const [mailOpen, setMailOpen] = useState(false);
  const rows = useQuery({
    queryKey: ["cancellations.recordedForMember", memberId],
    queryFn: () => orpc.cancellations.recordedForMember({ memberId }),
  });

  if (rows.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Erfasste Kündigung</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (rows.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Erfasste Kündigung</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryError error={rows.error} onRetry={() => rows.refetch()} />
        </CardContent>
      </Card>
    );
  }
  // A quick administrative Austritt leaves no receipt. The member can still be
  // sent a confirmation, so offer the action instead of hiding the card.
  if (rows.data.length === 0) {
    if (!austrittDatum) return null;
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-4" aria-hidden />
            Austritt
          </CardTitle>
          {canEdit ? (
            <Button variant="outline" size="sm" onClick={() => setMailOpen(true)}>
              <Mail className="size-4" /> Bestätigung senden
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Austritt zum {formatDate(austrittDatum)}. Ohne erfasste Kündigung, also ohne hinterlegte
          Austrittserklärung.
        </CardContent>
        <KuendigungsMailDialog open={mailOpen} onOpenChange={setMailOpen} memberId={memberId} />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4" aria-hidden />
          Erfasste Kündigung
        </CardTitle>
        {canEdit ? (
          <Button variant="outline" size="sm" onClick={() => setMailOpen(true)}>
            <Mail className="size-4" /> Bestätigung senden
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.data.map((row) => (
          <div
            key={row.id}
            className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">
                Austritt zum {formatDate(row.effectiveDate)}
              </span>
              {row.revokedAt ? <Badge variant="outline">Widerrufen</Badge> : null}
              {row.overridden ? <Badge variant="warning">Abweichender Termin</Badge> : null}
            </div>

            <dl className="grid gap-x-6 gap-y-1 text-muted-foreground sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="shrink-0">Eingang:</dt>
                <dd className="text-foreground">{formatDate(row.noticeReceivedOn)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0">Regel:</dt>
                <dd className="text-foreground">
                  {[
                    row.statuteReference,
                    modeLabel(row.dateMode),
                    row.noticeDays > 0 ? `Frist ${row.noticeDays} Tage` : "ohne Frist",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </dd>
              </div>
              {row.overridden ? (
                <div className="flex gap-2 sm:col-span-2">
                  <dt className="shrink-0">Nach Satzung wäre:</dt>
                  <dd className="text-foreground">{formatDate(row.computedEffectiveDate)}</dd>
                </div>
              ) : null}
              {row.overrideReason ? (
                <div className="flex gap-2 sm:col-span-2">
                  <dt className="shrink-0">Begründung:</dt>
                  <dd className="text-foreground">{orEmpty(row.overrideReason)}</dd>
                </div>
              ) : null}
              {row.note ? (
                <div className="flex gap-2 sm:col-span-2">
                  <dt className="shrink-0">Notiz:</dt>
                  <dd className="text-foreground">{orEmpty(row.note)}</dd>
                </div>
              ) : null}
              <div className="flex gap-2 sm:col-span-2">
                <dt className="shrink-0">Erfasst:</dt>
                <dd className="text-foreground">
                  {formatDateTime(row.recordedAt)} · {orEmpty(row.recordedByEmail)}
                </dd>
              </div>
            </dl>

            <a
              className="inline-flex w-fit items-center gap-2 text-sm text-primary underline underline-offset-2"
              href={`/api/files/${row.evidenceAttachmentId}`}
              target="_blank"
              rel="noreferrer"
            >
              <Paperclip className="size-4" aria-hidden />
              {row.evidenceFilename}
            </a>

            {row.sepaRevoked ? null : (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <FileText className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                SEPA-Mandate wurden bei der Erfassung nicht widerrufen.
              </p>
            )}
          </div>
        ))}
      </CardContent>
      <KuendigungsMailDialog open={mailOpen} onOpenChange={setMailOpen} memberId={memberId} />
    </Card>
  );
}
