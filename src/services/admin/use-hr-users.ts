/**
 * React Query bindings for the HR-seat endpoints. The HR page talks to these
 * and never to `./hr-users` directly, so caching, invalidation and error
 * reporting live in one place.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  createHrUser,
  listHrUsers,
  resetHrUserPassword,
  setHrUserActive,
  updateHrUser,
  type CreateHrInput,
  type UpdateHrInput,
} from "./hr-users"

/** Cache keys. `all` is the invalidation root for every write below. */
export const hrUserKeys = {
  all: ["company", "hrs"] as const,
}

export function useHrUsers() {
  return useQuery({ queryKey: hrUserKeys.all, queryFn: listHrUsers })
}

/**
 * Create, edit, enable/disable and reset-password for recruiter seats.
 *
 * `create` and `resetPassword` show no success toast: each returns a password
 * that can never be read again, so the page opens a dialog with it instead.
 */
export function useHrUserMutations() {
  const client = useQueryClient()

  const refresh = () => {
    void client.invalidateQueries({ queryKey: hrUserKeys.all })
  }
  const reportError = (error: Error) => toast.error(error.message)

  return {
    create: useMutation({
      mutationFn: (input: CreateHrInput) => createHrUser(input),
      onSuccess: refresh,
      onError: reportError,
    }),

    update: useMutation({
      mutationFn: ({
        userId,
        input,
      }: {
        userId: string
        input: UpdateHrInput
      }) => updateHrUser(userId, input),
      onSuccess: (hr) => {
        toast.success(`${hr.fullName || hr.email} updated.`)
        refresh()
      },
      onError: reportError,
    }),

    setActive: useMutation({
      mutationFn: ({
        userId,
        isActive,
      }: {
        userId: string
        isActive: boolean
      }) => setHrUserActive(userId, isActive),
      // `disable` returns no record, so the toast is built from what we sent
      // rather than from a response we don't get.
      onSuccess: (_result, { isActive }) => {
        toast.success(isActive ? "HR user enabled." : "HR user disabled.")
        refresh()
      },
      onError: reportError,
    }),

    resetPassword: useMutation({
      mutationFn: (userId: string) => resetHrUserPassword(userId),
      onSuccess: refresh,
      onError: reportError,
    }),
  }
}
