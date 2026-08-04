/**
 * Admin's backend surface — the `/api/company/*` endpoints, scoped by the
 * server to the signed-in Admin's own company. Import from here.
 *
 *   import { useHrUsers, useCompanyDashboard } from "@/services/admin"
 */

export * from "./hr-users"
export * from "./use-hr-users"
export * from "./company"
export * from "./use-company"
