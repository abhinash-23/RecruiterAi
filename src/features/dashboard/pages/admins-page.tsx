import * as React from "react"
import { format } from "date-fns"
import {
  KeyRound,
  Pencil,
  Plus,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserX,
} from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import {
  DataTable,
  type Column,
  type FilterSpec,
} from "@/components/shared/data-table"
import { EntityDialog } from "@/components/shared/entity-dialog"
import { IconAction } from "@/components/shared/icon-action"
import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ADMIN_CREATE_FIELDS, ADMIN_EDIT_FIELDS } from "@/config/entities"
import {
  usePlatformAdminMutations,
  usePlatformAdmins,
  type PlatformAdmin,
} from "@/services/super-admin"

import {
  CredentialsDialog,
  type IssuedCredentials,
} from "../credentials-dialog"

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

  const [editing, setEditing] = React.useState<PlatformAdmin | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [pendingReset, setPendingReset] = React.useState<PlatformAdmin | null>(
    null
  )
  const [pendingDisable, setPendingDisable] =
    React.useState<PlatformAdmin | null>(null)

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
      id: "lastLogin",
      header: "Last sign-in",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-muted-foreground">
          {row.lastLogin
            ? format(new Date(row.lastLogin), "d MMM yyyy · HH:mm")
            : "Never"}
        </span>
      ),
    },
    {
      id: "created",
      header: "Created",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-muted-foreground">
          {format(new Date(row.createdAt), "d MMM yyyy")}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={row.isActive ? "active" : "disabled"} />
          {/* A tenant without isolation can read every other tenant's
              interviews, so it needs to be visible at a glance, not buried. */}
          {!row.tenancyEnforced ? (
            <Badge
              variant="outline"
              className="h-auto gap-1 border-amber-500/40 py-0.5 text-[11px] font-normal whitespace-normal text-amber-700 dark:text-amber-400"
            >
              <ShieldAlert className="size-3" />
              Not isolated
            </Badge>
          ) : null}
        </div>
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
        label="Edit tenant"
        Icon={Pencil}
        onSelect={() => setEditing(row)}
      />
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
          onSelect={() =>
            mutations.setActive.mutate({ adminId: row.adminId, isActive: true })
          }
        />
      )}
      <IconAction
        label="Reset password"
        Icon={KeyRound}
        disabled={mutations.resetPassword.isPending}
        onSelect={() => setPendingReset(row)}
      />
      {/* Only offered where it's the repair — turning isolation *off* is not
          something a console should make one click away. */}
      {!row.tenancyEnforced ? (
        <IconAction
          label="Enforce data isolation"
          Icon={ShieldCheck}
          disabled={mutations.setTenancy.isPending}
          onSelect={() =>
            mutations.setTenancy.mutate({ adminId: row.adminId, enforced: true })
          }
        />
      ) : null}
    </>
  )

  return (
    <>
      <PageHeader
        title="Admin Management"
        description="Every company tenant on the platform, with its admin login and HR seats."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            Create Admin
          </Button>
        }
      />

      <DataTable
        rows={data ?? []}
        columns={columns}
        getRowId={(row) => row.adminId}
        loading={isLoading}
        searchAccessor={(row) =>
          `${row.name} ${row.slug} ${row.fullName} ${row.email}`
        }
        searchPlaceholder="Search company, admin or email…"
        filters={filters}
        inlineActions={rowActions}
        emptyMessage="No admins match these filters."
      />

      <EntityDialog
        open={creating}
        onOpenChange={setCreating}
        title="Create Admin"
        description="Creates the company workspace and its first admin login together, and emails them a temporary password."
        fields={ADMIN_CREATE_FIELDS}
        submitLabel="Create admin"
        pending={mutations.create.isPending}
        onSubmit={async (values) => {
          const result = await mutations.create.mutateAsync({
            name: String(values.name),
            adminEmail: String(values.adminEmail),
            adminFullName: String(values.adminFullName),
            adminPhone: String(values.adminPhone),
            supportEmail: String(values.supportEmail),
          })

          setCreating(false)
          if (!result.tenancyEnforced) {
            toast.warning(
              `${result.admin.name} was created, but switching on data isolation failed — use "Enforce data isolation" on the row before they sign in.`
            )
          }
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
        description="The admin can no longer sign in, and neither can their HR seats. Nothing is deleted — you can enable them again at any time."
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

      <CredentialsDialog
        credentials={credentials}
        onClose={() => setCredentials(null)}
      />
    </>
  )
}
