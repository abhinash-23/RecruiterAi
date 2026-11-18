import * as React from "react"
import { format } from "date-fns"
import {
  Building2,
  CalendarClock,
  Eye,
  KeyRound,
  Pencil,
  Plus,
  UserCheck,
  UserX,
} from "lucide-react"

import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import {
  DataTable,
  type Column,
  type FilterSpec,
} from "@/components/shared/data-table"
import { EntityDialog } from "@/components/shared/entity-dialog"
import { IconAction } from "@/components/shared/icon-action"
import { MetaChip, PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { ADMIN_CREATE_FIELDS, ADMIN_EDIT_FIELDS } from "@/config/entities"
import {
  usePlatformAdminMutations,
  usePlatformAdmins,
  type PlatformAdmin,
} from "@/services/super-admin"

import { AccessCell, AccessDialog, AccessPicker } from "../access-period"
import {
  NO_LIMIT,
  toAccessPeriod,
  type AccessValue,
} from "../access-period-value"
import {
  CredentialsDialog,
  type IssuedCredentials,
} from "../credentials-dialog"
import { useOrgDirectory } from "../org-directory"
import { OrgCreditsCell, OrgOverviewDialog } from "../org-overview-dialog"

/**
 * Super Admin's tenant list, backed by `/api/platform/admins`.
 *
 * The API shapes this screen in three ways worth knowing before editing it:
 *
 *  - **A tenant and its admin login are one record.** "Company" and "Admin" are
 *    two columns over the same row, not a join.
 *  - **There is no delete** — only disable/enable. Access is revoked, history
 *    is kept.
 *  - **Editing is limited to the company name and support email**, because that
 *    is all `PATCH` accepts. The admin's email is their login and is fixed.
 */
export function AdminsPage() {
  const { data, isLoading } = usePlatformAdmins()
  const mutations = usePlatformAdminMutations()
  const directory = useOrgDirectory()
  const [viewing, setViewing] = React.useState<string | null>(null)

  const [editing, setEditing] = React.useState<PlatformAdmin | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [pendingReset, setPendingReset] = React.useState<PlatformAdmin | null>(
    null
  )
  const [pendingDisable, setPendingDisable] =
    React.useState<PlatformAdmin | null>(null)
  const [changingAccess, setChangingAccess] =
    React.useState<PlatformAdmin | null>(null)
  const [enabling, setEnabling] = React.useState<PlatformAdmin | null>(null)
  // The create form's access period; reset each time the dialog opens.
  const [createAccess, setCreateAccess] = React.useState<AccessValue>(NO_LIMIT)

  // Holds the one-time password from a create or a reset until the operator
  // dismisses it. Nothing else can retrieve it afterwards.
  const [credentials, setCredentials] =
    React.useState<IssuedCredentials | null>(null)

  const columns: Array<Column<PlatformAdmin>> = [
    {
      id: "company",
      header: "Company",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {row.slug}
          </p>
        </div>
      ),
    },
    {
      id: "admin",
      header: "Admin",
      cell: (row) => (
        <div className="min-w-0">
          {/* A tenant can be created without a contact name, so fall back to
              the login rather than rendering an empty line. */}
          <p className="truncate">{row.fullName || "—"}</p>
          <p className="truncate text-xs text-muted-foreground">{row.email}</p>
        </div>
      ),
    },
    {
      id: "hr",
      header: "HR",
      hideOnMobile: true,
      className: "tabular-nums",
      cell: (row) => row.hrCount,
    },
    {
      id: "interviews",
      header: "Interviews",
      hideOnMobile: true,
      cell: (row) => {
        const interviews = directory.find(row.companyId)?.analytics?.interviews
        if (!interviews) {
          return <span className="text-muted-foreground">—</span>
        }
        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold tabular-nums">
              {interviews.total}
            </span>
            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {interviews.byStatus.completed ?? 0} completed
            </span>
          </div>
        )
      },
    },
    {
      id: "credits",
      header: "Credits left",
      cell: (row) => (
        <OrgCreditsCell
          org={directory.find(row.companyId)}
          directory={directory}
        />
      ),
    },
    {
      // Created rides under the sign-in rather than taking a column of its
      // own, so the table still fits a laptop with the new figures in it.
      id: "lastLogin",
      header: "Last sign-in",
      hideOnMobile: true,
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="whitespace-nowrap">
            {row.lastLogin
              ? format(new Date(row.lastLogin), "d MMM yyyy · HH:mm")
              : "Never"}
          </span>
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            Created {format(new Date(row.createdAt), "d MMM yyyy")}
          </span>
        </div>
      ),
    },
    {
      id: "access",
      header: "Access",
      hideOnMobile: true,
      cell: (row) => <AccessCell admin={row} />,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge status={row.isActive ? "active" : "disabled"} />
      ),
    },
  ]

  const filters: Array<FilterSpec<PlatformAdmin>> = [
    {
      id: "status",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "disabled", label: "Disabled" },
      ],
      predicate: (row, value) => row.isActive === (value === "active"),
    },
    {
      // The DataTable renders this as "All Credentials", so the label has to
      // read naturally after "All".
      id: "credentials",
      label: "Credentials",
      options: [
        { value: "pending", label: "Password change pending" },
        { value: "settled", label: "Password changed" },
      ],
      predicate: (row, value) =>
        row.mustChangePassword === (value === "pending"),
    },
  ]

  const rowActions = (row: PlatformAdmin) => (
    <>
      <IconAction
        label="View organization"
        Icon={Eye}
        onSelect={() => setViewing(row.companyId)}
      />
      <IconAction
        label="Edit tenant"
        Icon={Pencil}
        onSelect={() => setEditing(row)}
      />
      {row.isActive ? (
        <IconAction
          label="Change access"
          Icon={CalendarClock}
          onSelect={() => setChangingAccess(row)}
        />
      ) : null}
      {row.isActive ? (
        <IconAction
          label="Disable tenant"
          Icon={UserX}
          tone="destructive"
          disabled={mutations.setActive.isPending}
          // Enabling is harmless; disabling locks a whole tenant out, so it
          // goes through the confirmation below.
          onSelect={() => setPendingDisable(row)}
        />
      ) : (
        <IconAction
          label="Enable tenant"
          Icon={UserCheck}
          tone="positive"
          disabled={mutations.setActive.isPending}
          // Opens the access dialog: enabling also sets how long for.
          onSelect={() => setEnabling(row)}
        />
      )}
      <IconAction
        label="Reset password"
        Icon={KeyRound}
        disabled={mutations.resetPassword.isPending}
        onSelect={() => setPendingReset(row)}
      />
    </>
  )

  const rows = data ?? []
  const active = rows.filter((row) => row.isActive).length
  const disabled = rows.length - active
  const hrSeats = rows.reduce((sum, row) => sum + row.hrCount, 0)

  return (
    <>
      <PageHeader
        title="Management"
        icon={Building2}
        description="Every company tenant on the platform, with its admin login and HR seats."
        meta={
          isLoading ? null : (
            <>
              <MetaChip>
                {rows.length} {rows.length === 1 ? "company" : "companies"}
              </MetaChip>
              {active > 0 ? (
                <MetaChip tone="success">{active} active</MetaChip>
              ) : null}
              {disabled > 0 ? (
                <MetaChip tone="danger">{disabled} disabled</MetaChip>
              ) : null}
              <MetaChip>
                {hrSeats} HR {hrSeats === 1 ? "seat" : "seats"}
              </MetaChip>
            </>
          )
        }
        actions={
          <Button
            onClick={() => {
              setCreateAccess(NO_LIMIT)
              setCreating(true)
            }}
          >
            <Plus />
            Create Org
          </Button>
        }
      />

      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(row) => row.adminId}
        loading={isLoading}
        searchAccessor={(row) =>
          `${row.name} ${row.slug} ${row.fullName} ${row.email}`
        }
        searchPlaceholder="Search company, admin or email…"
        filters={filters}
        inlineActions={rowActions}
        onRowClick={(row) => setViewing(row.companyId)}
        emptyMessage="No admins match these filters."
      />

      <OrgOverviewDialog
        companyId={viewing}
        directory={directory}
        onClose={() => setViewing(null)}
      />

      <EntityDialog
        open={creating}
        onOpenChange={setCreating}
        title="Create Admin"
        description="Creates the company workspace and its first admin login together, and emails them a temporary password."
        fields={ADMIN_CREATE_FIELDS}
        submitLabel="Create admin"
        pending={mutations.create.isPending}
        extra={
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">Access</Label>
            <AccessPicker
              value={createAccess}
              onChange={setCreateAccess}
              idPrefix="create-access"
            />
            {toAccessPeriod(createAccess) === null ? (
              <p className="text-xs text-muted-foreground">
                Pick the date access ends.
              </p>
            ) : null}
          </div>
        }
        onSubmit={async (values) => {
          const access = toAccessPeriod(createAccess)
          // "Until a date" with no date: the hint above already says so.
          if (access === null) throw new Error("Pick the date access ends.")
          const result = await mutations.create.mutateAsync({
            name: String(values.name),
            adminEmail: String(values.adminEmail),
            adminFullName: String(values.adminFullName),
            adminPhone: String(values.adminPhone),
            supportEmail: String(values.supportEmail),
            access: access === "keep" ? undefined : access,
          })

          setCreating(false)
          setCredentials({
            subject: result.admin.name,
            noun: "Admin",
            email: result.admin.email,
            password: result.temporaryPassword,
            emailSent: result.credentialsEmailSent,
            kind: "created",
          })
        }}
      />

      <EntityDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        title="Edit Admin"
        description="The admin's email is their login and can't be changed here, and the URL slug keeps its original value after a rename."
        fields={ADMIN_EDIT_FIELDS}
        submitLabel="Save changes"
        pending={mutations.update.isPending}
        initialValues={
          editing
            ? { name: editing.name, supportEmail: editing.supportEmail }
            : null
        }
        onSubmit={async (values) => {
          if (!editing) return
          await mutations.update.mutateAsync({
            adminId: editing.adminId,
            input: {
              name: String(values.name),
              supportEmail: String(values.supportEmail),
            },
          })
          setEditing(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDisable)}
        onOpenChange={(open) => !open && setPendingDisable(null)}
        title={`Disable ${pendingDisable?.name ?? "this tenant"}?`}
        description="The admin can no longer sign in, and neither can their HR seats. Nothing is deleted. You can enable them again at any time."
        confirmLabel="Disable tenant"
        destructive
        onConfirm={() => {
          if (pendingDisable) {
            mutations.setActive.mutate({
              adminId: pendingDisable.adminId,
              isActive: false,
            })
          }
          setPendingDisable(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingReset)}
        onOpenChange={(open) => !open && setPendingReset(null)}
        title={`Reset password for ${pendingReset?.fullName || pendingReset?.email || "this admin"}?`}
        description="Their current password stops working immediately. We'll generate a temporary one, show it to you once, and email it to them."
        confirmLabel="Reset password"
        onConfirm={() => {
          const target = pendingReset
          setPendingReset(null)
          if (!target) return

          mutations.resetPassword.mutate(target.adminId, {
            onSuccess: (result) =>
              setCredentials({
                subject: target.name,
                noun: "Admin",
                email: target.email,
                password: result.newPassword,
                emailSent: result.credentialsEmailSent,
                kind: "reset",
              }),
          })
        }}
      />

      <AccessDialog
        admin={changingAccess}
        mode="change"
        onClose={() => setChangingAccess(null)}
      />

      <AccessDialog
        admin={enabling}
        mode="enable"
        onClose={() => setEnabling(null)}
      />

      <CredentialsDialog
        credentials={credentials}
        onClose={() => setCredentials(null)}
      />
    </>
  )
}
