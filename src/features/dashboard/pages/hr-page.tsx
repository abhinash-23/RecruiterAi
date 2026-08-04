import * as React from "react"
import { format } from "date-fns"
import { KeyRound, Pencil, Plus, UserCheck, UserX } from "lucide-react"

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
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { HR_CREATE_FIELDS, HR_EDIT_FIELDS } from "@/config/entities"
import { useHrUserMutations, useHrUsers, type HrUser } from "@/services/admin"

import { CredentialsDialog, type IssuedCredentials } from "../credentials-dialog"

function initials(value: string) {
  return (
    value
      .split(/[\s@.]+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  )
}

/**
 * Admin's recruiter seats, backed by `/api/company/hrs`. The server scopes
 * every call to the signed-in Admin's own company.
 *
 * Shaped by the API in the same three ways as the tenant list:
 *
 *  - **No delete** — seats are disabled, never removed.
 *  - **Editing covers name and phone only**, because that is all `PATCH`
 *    accepts. The email is their login and is fixed after creation.
 *  - **Create and reset each return a password shown exactly once**, so both
 *    open a dialog rather than a toast.
 */
export function HrPage() {
  const { data, isLoading } = useHrUsers()
  const mutations = useHrUserMutations()

  const [creating, setCreating] = React.useState(false)
  const [editing, setEditing] = React.useState<HrUser | null>(null)
  const [pendingReset, setPendingReset] = React.useState<HrUser | null>(null)
  const [pendingDisable, setPendingDisable] = React.useState<HrUser | null>(null)

  const [credentials, setCredentials] =
    React.useState<IssuedCredentials | null>(null)

  /** Their name if they have one, otherwise the login — never blank. */
  const label = (hr: HrUser) => hr.fullName || hr.email

  const columns: Array<Column<HrUser>> = [
    {
      id: "name",
      header: "Name",
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">
              {initials(label(row))}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.fullName || "—"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.email}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "phone",
      header: "Phone",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-muted-foreground">{row.phone || "—"}</span>
      ),
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
      header: "Added",
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
        <StatusBadge status={row.isActive ? "active" : "disabled"} />
      ),
    },
  ]

  const filters: Array<FilterSpec<HrUser>> = [
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


  return (
    <>
      <PageHeader
        title="HR Management"
        description="The recruiters in your company and their access."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            Create HR
          </Button>
        }
      />

      <DataTable
        rows={data ?? []}
        columns={columns}
        getRowId={(row) => row.userId}
        loading={isLoading}
        searchAccessor={(row) =>
          `${row.fullName} ${row.email} ${row.phone}`
        }
        searchPlaceholder="Search name, email or phone…"
        filters={filters}
        // One button per action rather than a `⋯` menu — same as Jobs.
        inlineActions={(row) => (
          <>
            <IconAction
              label="Edit recruiter"
              Icon={Pencil}
              onSelect={() => setEditing(row)}
            />
            {row.isActive ? (
              <IconAction
                label="Disable recruiter"
                Icon={UserX}
                tone="destructive"
                disabled={mutations.setActive.isPending}
                // Enabling is harmless; disabling locks someone out of their
                // account, so it goes through the confirmation below.
                onSelect={() => setPendingDisable(row)}
              />
            ) : (
              <IconAction
                label="Enable recruiter"
                Icon={UserCheck}
                tone="positive"
                disabled={mutations.setActive.isPending}
                onSelect={() =>
                  mutations.setActive.mutate({
                    userId: row.userId,
                    isActive: true,
                  })
                }
              />
            )}
            <IconAction
              label="Reset password"
              Icon={KeyRound}
              disabled={mutations.resetPassword.isPending}
              onSelect={() => setPendingReset(row)}
            />
          </>
        )}
        emptyMessage="No HR users yet — create the first seat."
      />

      <EntityDialog
        open={creating}
        onOpenChange={setCreating}
        title="Create HR user"
        description="Adds a recruiter and emails them a temporary password to change on first sign-in."
        fields={HR_CREATE_FIELDS}
        submitLabel="Create HR"
        pending={mutations.create.isPending}
        onSubmit={async (values) => {
          const result = await mutations.create.mutateAsync({
            email: String(values.email),
            fullName: String(values.fullName),
            phone: String(values.phone),
          })

          setCreating(false)
          setCredentials({
            subject: result.hr ? label(result.hr) : String(values.email),
            noun: "HR user",
            email: result.hr?.email ?? String(values.email),
            password: result.temporaryPassword,
            emailSent: result.credentialsEmailSent,
            kind: "created",
          })
        }}
      />

      <EntityDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        title="Edit HR user"
        description="Their email is their login and can't be changed here."
        fields={HR_EDIT_FIELDS}
        submitLabel="Save changes"
        pending={mutations.update.isPending}
        initialValues={
          editing
            ? { fullName: editing.fullName, phone: editing.phone }
            : null
        }
        onSubmit={async (values) => {
          if (!editing) return
          await mutations.update.mutateAsync({
            userId: editing.userId,
            input: {
              fullName: String(values.fullName),
              phone: String(values.phone),
            },
          })
          setEditing(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDisable)}
        onOpenChange={(open) => !open && setPendingDisable(null)}
        title={`Disable ${pendingDisable ? label(pendingDisable) : "this recruiter"}?`}
        description="They can no longer sign in. Their candidates and interviews stay exactly as they are, and you can enable them again at any time."
        confirmLabel="Disable HR user"
        destructive
        onConfirm={() => {
          if (pendingDisable) {
            mutations.setActive.mutate({
              userId: pendingDisable.userId,
              isActive: false,
            })
          }
          setPendingDisable(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingReset)}
        onOpenChange={(open) => !open && setPendingReset(null)}
        title={`Reset password for ${pendingReset ? label(pendingReset) : "this recruiter"}?`}
        description="Their current password stops working immediately. The server issues a new temporary one, shows it to you once, and emails it to them."
        confirmLabel="Reset password"
        onConfirm={() => {
          const target = pendingReset
          setPendingReset(null)
          if (!target) return

          mutations.resetPassword.mutate(target.userId, {
            onSuccess: (result) =>
              setCredentials({
                subject: label(target),
                noun: "HR user",
                email: target.email,
                password: result.temporaryPassword,
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
