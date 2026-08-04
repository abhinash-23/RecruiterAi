import * as React from "react"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreHorizontal,
  Search,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

export interface Column<Row> {
  id: string
  header: string
  /** Cell contents. Return a string/number for plain text. */
  cell: (row: Row) => React.ReactNode
  className?: string
  /** Hide below the `md` breakpoint to keep narrow screens readable. */
  hideOnMobile?: boolean
}

export interface RowAction<Row> {
  label: string | ((row: Row) => string)
  onSelect: (row: Row) => void
  tone?: "default" | "destructive"
  /** Hide the action for rows it doesn't apply to. */
  visible?: (row: Row) => boolean
}

/**
 * Rows per page, and the choices offered for it.
 *
 * Every table gets the selector by default: which of these is right depends on
 * the reader's screen and what they're doing, not on the page they happen to be
 * looking at.
 */
const DEFAULT_PAGE_SIZE = 5
const DEFAULT_PAGE_SIZE_OPTIONS = [5, 10, 25, 50]

export interface FilterSpec<Row> {
  id: string
  label: string
  options: Array<{ value: string; label: string }>
  /** Applied when the selected value is not `all`. */
  predicate: (row: Row, value: string) => boolean
}

interface DataTableProps<Row> {
  rows: Row[]
  columns: Array<Column<Row>>
  getRowId: (row: Row) => string
  loading?: boolean
  /** Fields concatenated for the search box to match against. */
  searchAccessor?: (row: Row) => string
  searchPlaceholder?: string
  filters?: Array<FilterSpec<Row>>
  actions?: Array<RowAction<Row>>
  /** Icon buttons rendered directly in the Actions cell. */
  inlineActions?: (row: Row) => React.ReactNode
  /** Rows per page before the reader changes it. */
  pageSize?: number
  /**
   * Choices in the rows-per-page selector. Defaults to
   * {@link DEFAULT_PAGE_SIZE_OPTIONS} — pass `[]` to hide the control for a
   * table whose length is fixed by something else.
   */
  pageSizeOptions?: number[]
  /** Prefix a numbered `#` column. */
  showIndex?: boolean
  /** Add a checkbox column plus a select-all control. */
  selectable?: boolean
  /**
   * Rows this returns false for can't be picked — their checkbox is disabled
   * and select-all skips them. They still count against the header's "all
   * selected", so a list with locked rows shows the mixed state rather than
   * claiming everything is selected.
   */
  isRowSelectable?: (row: Row) => boolean
  selectedIds?: string[]
  onSelectionChange?: (ids: string[]) => void
  emptyMessage?: string
  /** Rendered between the toolbar and the table, e.g. status tabs. */
  toolbarExtra?: React.ReactNode
  /** Rendered above the toolbar, e.g. a Bulk Upload button and Select All. */
  header?: React.ReactNode
  onRowClick?: (row: Row) => void
  className?: string
}

/**
 * The one table in the app. Every list — admins, HR, candidates, interviews,
 * activity — passes its own columns, filters and row actions instead of
 * reimplementing search, filtering and pagination.
 */
export function DataTable<Row>({
  rows,
  columns,
  getRowId,
  loading,
  searchAccessor,
  searchPlaceholder = "Search…",
  filters,
  actions,
  inlineActions,
  pageSize = DEFAULT_PAGE_SIZE,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  showIndex,
  selectable,
  isRowSelectable,
  selectedIds,
  onSelectionChange,
  emptyMessage = "Nothing to show yet.",
  toolbarExtra,
  header,
  onRowClick,
  className,
}: DataTableProps<Row>) {
  const [query, setQuery] = React.useState("")
  const [filterValues, setFilterValues] = React.useState<
    Record<string, string>
  >({})
  const [page, setPage] = React.useState(1)
  const [size, setSize] = React.useState(pageSize)

  // The starting size is always offered, even when a caller picks one that
  // isn't in the list — otherwise the trigger reads a number the menu can't
  // select, and reopening it looks broken.
  const sizeOptions = React.useMemo(
    () =>
      [...new Set([...pageSizeOptions, pageSize])].sort((a, b) => a - b),
    [pageSizeOptions, pageSize]
  )

  const activeFilters = filterValues

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase()

    return rows.filter((row) => {
      if (needle && searchAccessor) {
        if (!searchAccessor(row).toLowerCase().includes(needle)) return false
      }
      for (const filter of filters ?? []) {
        const value = activeFilters[filter.id]
        if (value && value !== "all" && !filter.predicate(row, value)) {
          return false
        }
      }
      return true
    })
  }, [rows, query, searchAccessor, filters, activeFilters])

  const pageCount = Math.max(1, Math.ceil(filtered.length / size))
  // Clamping here means a shrinking result set never leaves us on a page that
  // no longer exists, without resetting state from an effect.
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * size, currentPage * size)

  const hasActionsColumn = Boolean(actions?.length || inlineActions)
  const colSpan =
    columns.length +
    (hasActionsColumn ? 1 : 0) +
    (showIndex ? 1 : 0) +
    (selectable ? 1 : 0)

  // Select-all applies to the rows currently matching search + filters, not
  // just the visible page — otherwise "all" would silently mean "this page".
  const selection = selectedIds ?? []
  const filteredIds = filtered.map(getRowId)
  const canSelect = (row: Row) => isRowSelectable?.(row) ?? true

  // Measured against *every* filtered row, not just the pickable ones: with two
  // of three rows locked, ticking the one you can pick is not "all selected",
  // and a full tick there reads as though the locked rows came with it.
  const allSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selection.includes(id))

  const toggleAll = () => {
    // Keyed on "is anything selected" rather than on `allSelected`, which is
    // unreachable when some rows are locked — that would leave a control that
    // selects but never clears.
    onSelectionChange?.(
      selection.length > 0 ? [] : filtered.filter(canSelect).map(getRowId)
    )
  }

  const toggleRow = (id: string) => {
    onSelectionChange?.(
      selection.includes(id)
        ? selection.filter((item) => item !== id)
        : [...selection, id]
    )
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {header}

      {/* Always rendered: even a filter-less table wants the count and pager. */}
      <div className="flex flex-wrap items-center gap-2">
        {searchAccessor ? (
          <div className="relative min-w-56 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="pl-8"
            />
          </div>
        ) : null}

        {(filters ?? []).map((filter) => (
          <Select
            key={filter.id}
            value={activeFilters[filter.id] ?? "all"}
            onValueChange={(value) => {
              setFilterValues((prev) => ({
                ...prev,
                [filter.id]: String(value),
              }))
              setPage(1)
            }}
          >
            <SelectTrigger aria-label={filter.label} className="min-w-36">
              {/* Resolve the label ourselves: the items live in a portal that
                    isn't mounted until the popup opens, so Base UI would
                    otherwise fall back to printing the raw value. */}
              <SelectValue>
                {(value) => {
                  const selected = String(value ?? "all")
                  if (selected === "all") return `All ${filter.label}`
                  return (
                    filter.options.find((o) => o.value === selected)?.label ??
                    selected
                  )
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All {filter.label}</SelectItem>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}

        {toolbarExtra}

        {/* Count, page size and page position, right-aligned. */}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium whitespace-nowrap">
            Total: {filtered.length} Item(s)
          </span>

          {sizeOptions.length > 1 ? (
            <label className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-muted-foreground">Items per page</span>
              <Select
                value={String(size)}
                onValueChange={(value) => {
                  setSize(Number(value))
                  setPage(1)
                }}
              >
                <SelectTrigger aria-label="Items per page" className="w-18">
                  <SelectValue>{(value) => String(value ?? size)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sizeOptions.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : null}

          <span className="whitespace-nowrap text-muted-foreground">
            Page {currentPage} of {pageCount}
          </span>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="First page"
              disabled={currentPage <= 1}
              onClick={() => setPage(1)}
            >
              <ChevronsLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Previous page"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next page"
              disabled={currentPage >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              <ChevronRight />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Last page"
              disabled={currentPage >= pageCount}
              onClick={() => setPage(pageCount)}
            >
              <ChevronsRight />
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              {selectable ? (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    // A tick here means "every filtered row"; anything less is
                    // the mixed state, not a tick.
                    indeterminate={selection.length > 0 && !allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </TableHead>
              ) : null}
              {showIndex ? <TableHead className="w-14">#</TableHead> : null}
              {columns.map((column) => (
                <TableHead
                  key={column.id}
                  className={cn(
                    column.className,
                    column.hideOnMobile && "hidden md:table-cell"
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
              {/* Actions sizes to content rather than a fixed width: a cell
                  with several icon buttons would otherwise clip them. */}
              {hasActionsColumn ? (
                <TableHead className="w-0 text-right whitespace-nowrap">
                  Actions
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {Array.from({ length: colSpan }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full max-w-32" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row, rowIndex) => (
                <TableRow
                  key={getRowId(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={onRowClick ? "cursor-pointer" : undefined}
                  data-selected={
                    selectable && selection.includes(getRowId(row))
                      ? "true"
                      : undefined
                  }
                >
                  {selectable ? (
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={selection.includes(getRowId(row))}
                        disabled={!canSelect(row)}
                        onCheckedChange={() => toggleRow(getRowId(row))}
                        aria-label="Select row"
                      />
                    </TableCell>
                  ) : null}

                  {showIndex ? (
                    <TableCell>
                      <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500 text-xs font-semibold text-white tabular-nums">
                        {(currentPage - 1) * size + rowIndex + 1}
                      </span>
                    </TableCell>
                  ) : null}

                  {columns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(
                        column.className,
                        column.hideOnMobile && "hidden md:table-cell"
                      )}
                    >
                      {column.cell(row)}
                    </TableCell>
                  ))}

                  {hasActionsColumn ? (
                    <TableCell className="text-right">
                      {/* Inline icons and the overflow menu share one row so a
                          cell with both doesn't double the row height. */}
                      <div
                        className="flex flex-nowrap items-center justify-end gap-1.5"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {inlineActions?.(row)}

                        {actions?.length ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Row actions"
                                  onClick={(event) => event.stopPropagation()}
                                />
                              }
                            >
                              <MoreHorizontal />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {actions
                                .filter(
                                  (action) => action.visible?.(row) ?? true
                                )
                                .map((action) => {
                                  const label =
                                    typeof action.label === "function"
                                      ? action.label(row)
                                      : action.label
                                  return (
                                    <DropdownMenuItem
                                      key={label}
                                      variant={
                                        action.tone === "destructive"
                                          ? "destructive"
                                          : "default"
                                      }
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        action.onSelect(row)
                                      }}
                                    >
                                      {label}
                                    </DropdownMenuItem>
                                  )
                                })}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {selectable && selection.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {selection.length} selected
        </p>
      ) : null}
    </div>
  )
}
