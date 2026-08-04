import { format, formatDistanceToNow } from "date-fns"

import { DataTable, type Column } from "@/components/shared/data-table"
import { PageHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { useCurrentUser } from "@/features/auth/auth-context"
import { useCompanyAuditLogs, type AuditLogEntry } from "@/services/admin"
import { usePlatformAuditLogs } from "@/services/super-admin"

/** `candidates_scheduled` → `Candidates scheduled`. */
function humanise(action: string) {
  const spaced = action.replace(/[._-]+/g, " ").trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * The audit trail.
 *
 * Two endpoints with the same row shape: a super admin reads the whole
 * platform's, everyone else reads their own company's. Which one is used
 * follows the role, since the other answers 403.
 */
export function ActivityLogsPage() {
  const user = useCurrentUser()
  const isPlatform = user.role === "super_admin"

  // Both hooks are always called — React requires a stable hook order — but
  // only the one the role may read is enabled; the other endpoint 403s.
  const platform = usePlatformAuditLogs(100, isPlatform)
  const company = useCompanyAuditLogs(100, !isPlatform)
  const query = isPlatform ? platform : company

  const columns: Array<Column<AuditLogEntry>> = [
    {
      id: "action",
      header: "Action",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{humanise(row.action)}</p>
          {row.target ? (
            <p className="truncate text-xs text-muted-foreground">
              {row.target}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: "actor",
      header: "By",
      cell: (row) => (
        <span className="text-muted-foreground">{row.actorEmail}</span>
      ),
    },
    {
      id: "details",
      header: "Details",
      hideOnMobile: true,
      cell: (row) => {
        const entries = Object.entries(row.details ?? {})
        if (entries.length === 0) {
          return <span className="text-muted-foreground">—</span>
        }
        return (
          <div className="flex max-w-sm flex-wrap gap-1">
            {entries.map(([key, value]) => (
              <Badge
                key={key}
                variant="secondary"
                className="h-auto font-normal whitespace-normal"
              >
                {key.replace(/_/g, " ")}: {String(value)}
              </Badge>
            ))}
          </div>
        )
      },
    },
    {
      id: "ip",
      header: "IP",
      hideOnMobile: true,
      cell: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.ipAddress || "—"}
        </span>
      ),
    },
    {
      id: "when",
      header: "When",
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="whitespace-nowrap">
            {format(new Date(row.createdAt), "d MMM yyyy · HH:mm")}
          </span>
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
          </span>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Activity Logs"
        description={
          isPlatform
            ? "Every action taken across the platform, newest first."
            : "Everything that happened in your company, newest first."
        }
      />

      <DataTable
        rows={query.data ?? []}
        columns={columns}
        // The API returns no id per row. A timestamp plus the actor and action
        // is the closest thing to a stable key available.
        getRowId={(row) => `${row.createdAt}-${row.actorEmail}-${row.action}`}
        loading={query.isLoading}
        searchAccessor={(row) =>
          `${row.action} ${row.actorEmail} ${row.target}`
        }
        searchPlaceholder="Search action, person or target…"
        emptyMessage="Nothing recorded yet."
      />
    </>
  )
}
