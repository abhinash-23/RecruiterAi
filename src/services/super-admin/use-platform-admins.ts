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
  setPlatformAdminActive,
  setTenancyEnforcement,
  updatePlatformAdmin,
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
      }: {
        adminId: string
        isActive: boolean
      }) => setPlatformAdminActive(adminId, isActive),
      onSuccess: (admin) => {
        toast.success(`${admin.name} ${admin.isActive ? "enabled" : "disabled"}.`)
        refresh()
      },
      onError: reportError,
    }),

    resetPassword: useMutation({
      // The password is generated in the service when not supplied.
      mutationFn: (adminId: string) => resetPlatformAdminPassword(adminId),
      onSuccess: refresh,
      onError: reportError,
    }),

    /** Repairs a tenant created before isolation was switched on by default. */
    setTenancy: useMutation({
      mutationFn: ({
        adminId,
        enforced,
      }: {
        adminId: string
        enforced: boolean
      }) => setTenancyEnforcement(adminId, enforced),
      onSuccess: (admin) => {
        toast.success(
          admin.tenancyEnforced
            ? `${admin.name} is now isolated from other tenants.`
            : `${admin.name} can now see platform-wide interview data.`
        )
        refresh()
      },
      onError: reportError,
    }),
  }
}
