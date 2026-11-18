import * as React from "react"
import { format, formatDistanceToNow } from "date-fns"
import {
  Activity,
  ChevronDown,
  Download,
  ListFilter,
  Loader2,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { DataTable, type Column } from "@/components/shared/data-table"
import { MetaChip, PageHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useCurrentUser } from "@/features/auth/auth-context"
import { exportCompanyAuditLogs, useCompanyAuditLogs } from "@/services/admin"
import {
  AUDIT_LOG_MAX_LIMIT,
  AUDIT_SEARCH_MAX_LENGTH,
  auditActionLabel as humanise,
  auditRowId,
  type AuditLogEntry,
  type AuditLogFilters,
  type AuditLogPageRequest,
} from "@/services/audit-log"
import { ApiError } from "@/services/http-client"
import {
  useAuditLogActions,
  useExportAuditLogs,
  usePlatformAuditLogs,
} from "@/services/super-admin"

/** How long the search box waits after the last keystroke. */
const SEARCH_DEBOUNCE_MS = 300

/** Rows per page to start with; the reader can change it. */
const DEFAULT_PAGE_SIZE = 25

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/**
 * One `details` value as a reader wants it: dates in their own time, and an
 * access period's `null` as what it means.
 */
function detailValue(action: string, value: unknown): string {
  if (value === null || value === undefined) {
    return action === "admin_access_set" ? "No limit" : "—"
  }
  if (typeof value === "string" && ISO_DATE_TIME.test(value)) {
    const utc = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`
    const date = new Date(utc)
    if (!Number.isNaN(date.getTime())) return format(date, "d MMM yyyy, h:mm a")
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value)
}

/** Empty fields dropped and actions sorted, so equal filters compare equal. */
function tidy(filters: AuditLogFilters): AuditLogFilters {
  return {
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
    ...(filters.actions?.length
      ? { actions: [...filters.actions].sort() }
      : {}),
  }
}

const sameFilters = (a: AuditLogFilters, b: AuditLogFilters) =>
  JSON.stringify(tidy(a)) === JSON.stringify(tidy(b))

const isEmpty = (filters: AuditLogFilters) =>
  Object.keys(tidy(filters)).length === 0

/* ========================================================================== */
/*  Actions multi-select                                                      */
/* ========================================================================== */

function ActionsPicker({
  id,
  choices,
  value,
  onChange,
}: {
  id: string
  /** `count` is absent when the choices were read off the loaded rows. */
  choices: Array<{ action: string; count?: number }>
  value: string[]
  onChange: (next: string[]) => void
}) {
  const label =
    value.length === 0
      ? "All actions"
      : value.length === 1
        ? humanise(value[0])
        : `${value.length} actions`

  const toggle = (action: string, checked: boolean) =>
    onChange(
      checked ? [...value, action] : value.filter((item) => item !== action)
    )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            id={id}
            variant="outline"
            className="w-full justify-between font-normal sm:w-52"
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          <ListFilter className="text-muted-foreground" />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-80 w-64">
        {value.length > 0 ? (
          <>
            <DropdownMenuItem onClick={() => onChange([])}>
              <X />
              Clear selection
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {choices.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            No actions recorded yet.
          </p>
        ) : (
          choices.map((choice) => (
            <DropdownMenuCheckboxItem
              key={choice.action}
              checked={value.includes(choice.action)}
              closeOnClick={false}
              onCheckedChange={(checked) => toggle(choice.action, checked)}
            >
              <span className="min-w-0 flex-1 truncate">
                {humanise(choice.action)}
              </span>
              {choice.count !== undefined ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {choice.count}
                </span>
              ) : null}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ========================================================================== */
/*  Filter bar (super admin)                                                  */
/* ========================================================================== */

/**
 * From / To / Actions, then Apply and Export CSV. Export uses what's in the
 * fields right now and applies it too, so the file and the table always
 * describe the same entries.
 */
function AuditFilterBar({
  applied,
  onApply,
  choices,
  loading,
  shownCount,
  search,
  canExport,
  scope,
  capped,
}: {
  applied: AuditLogFilters
  onApply: (filters: AuditLogFilters) => void
  choices: Array<{ action: string; count?: number }>
  /** The table is re-reading after an Apply. */
  loading: boolean
  /** Entries matching `applied` and `search`, or null while unknown. */
  shownCount: number | null
  /** The search the table is showing; the export sends it too. */
  search: string
  /** Export CSV: the super admin and an admin; HR gets 403. */
  canExport: boolean
  /** Which trail the export downloads. */
  scope: "platform" | "company"
  /** An older backend: the table holds only the newest 500. */
  capped: boolean
}) {
  const exporter = useExportAuditLogs(
    scope === "company" ? exportCompanyAuditLogs : undefined
  )
  const [draft, setDraft] = React.useState<AuditLogFilters>(applied)
  const today = format(new Date(), "yyyy-MM-dd")

  const from = draft.dateFrom ?? ""
  const to = draft.dateTo ?? ""
  const rangeInvalid = Boolean(from && to && from > to)
  const dirty = !sameFilters(draft, applied)
  const anything = !isEmpty(draft) || !isEmpty(applied)

  const apply = () => {
    if (!rangeInvalid) onApply(tidy(draft))
  }

  const clear = () => {
    setDraft({})
    onApply({})
  }

  const exportCsv = () => {
    if (rangeInvalid) return
    const filters = tidy(draft)
    // Known only when these are the filters the table already shows.
    const knownEmpty = !dirty && shownCount === 0
    onApply(filters)
    exporter.mutate({ ...filters, q: search }, {
      onSuccess: (file) => {
        if (knownEmpty) {
          toast.warning(
            `No entries match these filters, so ${file.filename} has only the header row.`
          )
        } else {
          toast.success(`Downloaded ${file.filename}`)
        }
      },
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          apply()
        }}
      >
        <div className="flex min-w-36 flex-1 flex-col gap-1.5 sm:flex-initial">
          <Label htmlFor="audit-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="audit-from"
            type="date"
            className="sm:w-40 dark:scheme-dark"
            value={from}
            max={to || today}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, dateFrom: event.target.value }))
            }
          />
        </div>
        <div className="flex min-w-36 flex-1 flex-col gap-1.5 sm:flex-initial">
          <Label htmlFor="audit-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="audit-to"
            type="date"
            className="sm:w-40 dark:scheme-dark"
            value={to}
            min={from || undefined}
            max={today}
            aria-invalid={rangeInvalid}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, dateTo: event.target.value }))
            }
          />
        </div>
        <div className="flex w-full flex-col gap-1.5 sm:w-auto">
          <Label
            htmlFor="audit-actions"
            className="text-xs text-muted-foreground"
          >
            Actions
          </Label>
          <ActionsPicker
            id="audit-actions"
            choices={choices}
            value={draft.actions ?? []}
            onChange={(actions) => setDraft((prev) => ({ ...prev, actions }))}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!dirty || rangeInvalid}>
            {loading ? <Loader2 className="animate-spin" /> : null}
            Apply
          </Button>
          {anything ? (
            <Button type="button" variant="ghost" onClick={clear}>
              <X />
              Clear
            </Button>
          ) : null}
        </div>

        {canExport ? (
          <Button
            type="button"
            variant="outline"
            className="w-full sm:ml-auto sm:w-auto"
            disabled={exporter.isPending || rangeInvalid}
            onClick={exportCsv}
          >
            {exporter.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Download />
            )}
            {exporter.isPending ? "Exporting…" : "Export CSV"}
          </Button>
        ) : null}
      </form>

      {rangeInvalid ? (
        <p className="text-xs text-destructive">
          The From date is after the To date.
        </p>
      ) : dirty ? (
        <p className="text-xs text-muted-foreground">
          {canExport
            ? "Press Apply to update the table. Export CSV uses these filters as they are."
            : "Press Apply to update the table."}
        </p>
      ) : capped && shownCount !== null && shownCount >= AUDIT_LOG_MAX_LIMIT ? (
        <p className="text-xs text-muted-foreground">
          Showing the newest {AUDIT_LOG_MAX_LIMIT}.{" "}
          {canExport
            ? "Narrow the filters, or export CSV to get every matching entry."
            : "Narrow the filters to see older entries."}
        </p>
      ) : null}
    </div>
  )
}

/* ========================================================================== */
/*  Page                                                                      */
/* ========================================================================== */

/**
 * The audit trail.
 *
 * Two endpoints with the same query and row shape: a super admin reads the
 * whole platform's, everyone else reads their own company's. Which one is used
 * follows the role, since the other answers 403. Both take dates, actions and
 * a search, and both export to CSV (an admin's export is their company's
 * only); the Actions list with counts is the platform's alone.
 *
 * **Paged by cursor.** Each page's reply names the next page's cursor, and
 * `cursors` keeps the ones used so Previous can step back. Any change to the
 * search, dates, actions or page size starts again from page 1: a cursor
 * belongs to one set of filters.
 *
 * A backend from before paging (no `total` in the reply) gets the old
 * behaviour instead: one read of the newest 500, searched in the browser.
 */
export function ActivityLogsPage() {
  const user = useCurrentUser()
  const isPlatform = user.role === "super_admin"
  const [filters, setFilters] = React.useState<AuditLogFilters>({})
  const [search, setSearch] = React.useState("")
  const q = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS)
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE)
  /** The cursor each page was read with; page N is `cursors[N - 1]`. */
  const [cursors, setCursors] = React.useState<Array<string | null>>([null])
  /** Set once a reply shows a backend from before paging. */
  const [legacy, setLegacy] = React.useState(false)

  // New filters, search or page size: back to page 1.
  const scope = JSON.stringify([tidy(filters), legacy ? "" : q, pageSize])
  const [seenScope, setSeenScope] = React.useState(scope)
  if (scope !== seenScope) {
    setSeenScope(scope)
    setCursors([null])
  }

  const page = cursors.length
  const request: AuditLogPageRequest = legacy
    ? { filters: tidy(filters), limit: AUDIT_LOG_MAX_LIMIT, cursor: null }
    : {
        filters: { ...tidy(filters), q },
        limit: pageSize,
        cursor: cursors[page - 1],
      }

  // Both hooks are always called — React requires a stable hook order — but
  // only the one the role may read is enabled; the other endpoint 403s.
  const platform = usePlatformAuditLogs(request, isPlatform)
  const company = useCompanyAuditLogs(request, !isPlatform)
  const actions = useAuditLogActions(isPlatform)
  const query = isPlatform ? platform : company
  const data = query.data

  if (data && !data.paged && !legacy) setLegacy(true)

  // A cursor the server won't take ("Not a valid cursor"): back to page 1.
  const badCursor =
    query.error instanceof ApiError && query.error.status === 422 && page > 1
  if (badCursor) setCursors([null])

  const entries = data?.logs ?? []
  const total = data?.total ?? 0
  const filtered = !isEmpty(filters) || Boolean(q)

  // From the backend when it has the endpoint; otherwise whatever actions the
  // loaded rows show, plus any already picked so they can be unpicked.
  const choices = React.useMemo<
    Array<{ action: string; count?: number }>
  >(() => {
    if (actions.data) return actions.data
    const seen = new Set([
      ...(data?.logs ?? []).map((entry) => entry.action),
      ...(filters.actions ?? []),
    ])
    return [...seen].sort().map((action) => ({ action }))
  }, [actions.data, data, filters.actions])

  // There is only a forward cursor: Next pushes the one this page named,
  // Previous and First drop back to one already used.
  const goToPage = (next: number) => {
    if (next > page) {
      const cursor = data?.nextCursor
      if (cursor) setCursors([...cursors, cursor])
    } else if (next < page) {
      setCursors(cursors.slice(0, Math.max(1, next)))
    }
  }

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
        <span className="block truncate text-muted-foreground">
          {row.actorEmail}
        </span>
      ),
    },
    {
      id: "details",
      header: "Details",
      hideOnMobile: true,
      cell: (row) => {
        const details = Object.entries(row.details ?? {})
        if (details.length === 0) {
          return <span className="text-muted-foreground">—</span>
        }
        return (
          <div className="flex max-w-sm flex-wrap gap-1">
            {details.map(([key, value]) => (
              <Badge
                key={key}
                variant="secondary"
                className="h-auto font-normal whitespace-normal"
              >
                {key.replace(/_/g, " ")}: {detailValue(row.action, value)}
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
      header: "Date & time",
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

  const paging = legacy
    ? {
        searchAccessor: (row: AuditLogEntry) =>
          `${humanise(row.action)} ${row.action} ${row.actorEmail} ${row.target}`,
        pageSize: 5,
      }
    : {
        serverSearch: {
          value: search,
          onChange: setSearch,
          maxLength: AUDIT_SEARCH_MAX_LENGTH,
        },
        serverPaging: {
          total,
          page,
          pageSize,
          onPageChange: goToPage,
          hasNext: Boolean(data?.nextCursor),
          onPageSizeChange: setPageSize,
        },
      }

  return (
    <>
      <PageHeader
        title="Activity Logs"
        icon={Activity}
        description={
          isPlatform
            ? "Every action taken across the platform, newest first."
            : "Everything that happened in your company, newest first."
        }
        meta={
          <>
            <MetaChip tone="brand">
              {isPlatform ? "Whole platform" : "Your company"}
            </MetaChip>
            {query.isLoading ? null : (
              <MetaChip>
                {total.toLocaleString()} {total === 1 ? "entry" : "entries"}
              </MetaChip>
            )}
            {filtered ? <MetaChip>Filtered</MetaChip> : null}
          </>
        }
      />

      <DataTable
        rows={entries}
        columns={columns}
        getRowId={auditRowId}
        loading={query.isLoading}
        header={
          <>
            <AuditFilterBar
              applied={filters}
              onApply={setFilters}
              choices={choices}
              loading={query.isFetching && !query.isLoading}
              shownCount={query.isSuccess ? total : null}
              search={legacy ? "" : q}
              canExport={isPlatform || user.role === "admin"}
              scope={isPlatform ? "platform" : "company"}
              capped={legacy}
            />
            {query.error && !badCursor ? (
              <p className="text-sm text-destructive">{query.error.message}</p>
            ) : null}
          </>
        }
        {...paging}
        pageSizeOptions={[10, 25, 50, 100]}
        searchPlaceholder="Search action, person, company or IP…"
        emptyMessage={
          filtered ? "No entries match these filters." : "Nothing recorded yet."
        }
      />
    </>
  )
}
