import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Mailbox, Paperclip } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { QueryError } from "~/components/ui/query-error";
import { Skeleton } from "~/components/ui/skeleton";
import { toast } from "~/components/ui/toaster";
import { formatDateTime, orEmpty } from "~/lib/format";
import { orpc } from "~/lib/orpc";

/**
 * Letters written to this member. They used to exist only as a download, so a
 * lost file meant writing the letter again under a second document reference.
 * Listing them here makes the member page the place where the correspondence
 * lives, in both directions.
 */
export function BriefeCard({ memberId }: { memberId: string }) {
  const rows = useQuery({
    queryKey: ["letters.listForMember", memberId],
    queryFn: () => orpc.letters.listForMember({ memberId }),
  });

  const download = useMutation({
    mutationFn: (id: string) => orpc.letters.download({ id }),
    onSuccess: (res) => {
      window.open(res.url, "_blank", "noopener,noreferrer");
    },
    onError: (cause: Error) =>
      toast.error("Brief konnte nicht geöffnet werden", { description: cause.message }),
  });

  if (rows.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Briefe</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (rows.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Briefe</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryError error={rows.error} onRetry={() => rows.refetch()} />
        </CardContent>
      </Card>
    );
  }
  if (rows.data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mailbox className="size-4" aria-hidden />
          Briefe
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.data.map((row) => {
          // The letter itself is the first attachment name; the rest are the
          // enclosures noted on it.
          const enclosures = (row.attachmentNames ?? []).slice(1);
          return (
            <div
              key={row.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-3 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground">{orEmpty(row.subject)}</p>
                <p className="text-xs text-muted-foreground">
                  {orEmpty(row.docRef)} · {formatDateTime(row.createdAt)} ·{" "}
                  {orEmpty(row.actorEmail)}
                </p>
                {enclosures.length > 0 ? (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Paperclip className="size-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 truncate">{enclosures.join(", ")}</span>
                  </p>
                ) : null}
              </div>
              {row.hasDocument ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={download.isPending}
                  onClick={() => download.mutate(row.id)}
                >
                  <Download className="size-4" /> Öffnen
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Nur heruntergeladen</span>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
