/**
 * React Query bindings for the platform-admin endpoints.
 *
 * The page component talks to these and never to `fetch` or to
 * `./platform-admins` directly, so caching, invalidation and error toasts are
 * defined once.
 *
 * Errors: every call rejects with an `ApiError` whose `message` is already
 * written for the reader (the backend's own sentence — e.g. *"'x@y.com' is
 * already registered as a user."* on a 409), so the handlers just show it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { refreshDerivedReads } from "@/services/derived-reads"

import {
  createPlatformAdmin,
  listPlatformAdmins,
  resetPlatformAdminPassword,
  setPlatformAdminAccess,
  setPlatformAdminActive,
  updatePlatformAdmin,
  type AccessPeriod,
  type CreatePlatformAdminInput,
  type UpdatePlatformAdminInput,
} from "./platform-admins"

/** Cache keys. `all` is the invalidation root for every write below. */
export const platformAdminKeys = {
  all: ["platform", "admins"] as const,
}

/** The tenant list. Returns `[]` while loading, never `undefined` to the table. */
export function usePlatformAdmins() {
  return useQuery({
    queryKey: platformAdminKeys.all,
    queryFn: () => listPlatformAdmins(),
  })
}

/**
 * Create, edit, enable/disable and reset-password, each already wired to
 * refetch the list and to report failures.
 *
 * `create` and `resetPassword` deliberately show **no success toast**: both
 * return a password that is never retrievable again, so the caller opens a
 * dialog with it instead of letting it scroll past in a toast.
 */
export function usePlatformAdminMutations() {
  const client = useQueryClient()

  const refresh = () => {
    void client.invalidateQueries({ queryKey: platformAdminKeys.all })
    // Tenant counts on the platform overview, and the audit trail, both move
    // with every write here.
    refreshDerivedReads(client)
  }
  const reportError = (error: Error) => toast.error(error.message)

  return {
    create: useMutation({
      mutationFn: (input: CreatePlatformAdminInput) =>
        createPlatformAdmin(input),
      onSuccess: refresh,
      onError: reportError,
    }),

    update: useMutation({
      mutationFn: ({
        adminId,
        input,
      }: {
        adminId: string
        input: UpdatePlatformAdminInput
      }) => updatePlatformAdmin(adminId, input),
      onSuccess: (admin) => {
        toast.success(`${admin.name} updated.`)
        refresh()
      },
      onError: reportError,
    }),

    setActive: useMutation({
      mutationFn: ({
        adminId,
        isActive,
        access,
      }: {
        adminId: string
        isActive: boolean
        /**
         * Enable only, from the access dialog. `"keep"` (or omitted): a period
         * that is still running carries on, an ended one is removed.
         */
        access?: AccessPeriod | "keep"
      }) =>
        setPlatformAdminActive(
          adminId,
          isActive,
          access === "keep" ? undefined : access
        ),
      onSuccess: (admin) => {
        toast.success(`${admin.name} ${admin.isActive ? "enabled" : "disabled"}.`)
        refresh()
      },
      // An enable with a period comes from the access dialog, which shows the
      // server's sentence inline instead.
      onError: (error, { access }) => {
        if (access === undefined) reportError(error)
      },
    }),

    /** No error toast: the access dialog shows the server's sentence inline. */
    setAccess: useMutation({
      mutationFn: ({
        adminId,
        access,
      }: {
        adminId: string
        access: AccessPeriod
      }) => setPlatformAdminAccess(adminId, access),
      onSuccess: (admin) => {
        toast.success(`Access updated for ${admin.name}.`)
        refresh()
      },
    }),

    resetPassword: useMutation({
      // The password is generated in the service when not supplied.
      mutationFn: (adminId: string) => resetPlatformAdminPassword(adminId),
      onSuccess: refresh,
      onError: reportError,
    }),
  }
}
