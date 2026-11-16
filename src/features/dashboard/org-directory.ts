import { useCreditPricing } from "@/features/billing/pricing"
import { usePlatformBilling, type AdminCredits } from "@/services/billing"
import {
  usePlatformAdmins,
  usePlatformAnalytics,
  type CompanyAnalytics,
  type PlatformAdmin,
} from "@/services/super-admin"

/**
 * Everything the super admin can know about one organization, from the three
 * lists that each hold part of it:
 *
 *  - `/platform/analytics` — interviews and seats
 *  - `/platform/admins` — the admin login, HR count, status
 *  - `/platform/billing` — the credit wallet
 *
 * Each part is optional: a list that failed or hasn't loaded leaves its part
 * out rather than holding up the rest.
 */
export interface OrgFacts {
  companyId: string
  name: string
  slug: string
  analytics: CompanyAnalytics | null
  admin: PlatformAdmin | null
  credits: AdminCredits | null
}

const normalise = (name: string) => name.trim().toLowerCase()

/**
 * The three super-admin lists, joined per organization.
 *
 * The tenant *is* the admin record, so a company's id and its admin's id are
 * the same value, and that is the join. The name is a fallback for a billing
 * row keyed some other way.
 */
export function useOrgDirectory() {
  const analytics = usePlatformAnalytics()
  const admins = usePlatformAdmins()
  const billing = usePlatformBilling()
  const { interviewCost } = useCreditPricing()

  const creditsById = new Map(
    (billing.data ?? []).map((row) => [row.adminId, row])
  )
  const creditsByName = new Map(
    (billing.data ?? []).map((row) => [normalise(row.adminName), row])
  )
  const analyticsById = new Map(
    (analytics.data?.companies ?? []).map((row) => [row.companyId, row])
  )
  const adminsById = new Map(
    (admins.data ?? []).map((row) => [row.companyId, row])
  )

  const find = (companyId: string | null): OrgFacts | null => {
    if (!companyId) return null
    const company = analyticsById.get(companyId) ?? null
    const admin = adminsById.get(companyId) ?? null
    const name = admin?.name ?? company?.name
    if (!name) return null
    return {
      companyId,
      name,
      slug: admin?.slug ?? company?.slug ?? "",
      analytics: company,
      admin,
      credits:
        creditsById.get(companyId) ??
        (admin ? creditsById.get(admin.adminId) : undefined) ??
        creditsByName.get(normalise(name)) ??
        null,
    }
  }

  return {
    find,
    interviewCost,
    /** False when billing isn't switched on: credit columns show a dash. */
    billingAvailable: !billing.isError,
    billingLoading: billing.isLoading,
    analyticsLoading: analytics.isLoading,
  }
}

export type OrgDirectory = ReturnType<typeof useOrgDirectory>

/** Interviews someone is sitting right now, or has agreed to and is about to. */
export function interviewsUnderway(company: CompanyAnalytics | null) {
  const byStatus = company?.interviews.byStatus ?? {}
  return (byStatus.in_progress ?? 0) + (byStatus.consent_given ?? 0)
}
