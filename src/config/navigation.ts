import {
  Activity,
  BarChart3,
  Briefcase,
  Building2,
  CalendarClock,
  FileText,
  LayoutDashboard,
  Palette,
  Radio,
  Settings,
  User,
  Users,
  type LucideIcon,
} from "lucide-react"

import type { Role } from "@/features/auth/types"

export interface NavItem {
  label: string
  to: string
  Icon: LucideIcon
  /** Matches nested routes too; the index route matches exactly. */
  end?: boolean
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/**
 * Sidebar contents per role. This is the single source for both the sidebar and
 * the route table, so a page can never be reachable without a menu entry.
 *
 * The shape follows the API's own hierarchy:
 *
 *  - **Super admin** manages tenants and the platform. The API answers 403 for
 *    candidate and interview data at this tier, so no such pages exist here.
 *  - **Admin** manages their company and can do everything HR can.
 *  - **HR** works the funnel: jobs → candidates → interviews → results.
 */
export const NAVIGATION: Record<Role, NavGroup[]> = {
  super_admin: [
    {
      label: "Platform",
      items: [
        {
          label: "Dashboard",
          to: "/super-admin",
          Icon: LayoutDashboard,
          end: true,
        },
        {
          label: "Org Management",
          to: "/super-admin/admins",
          Icon: Building2,
        },
      ],
    },
    {
      label: "Governance",
      items: [
        {
          label: "System Settings",
          to: "/super-admin/settings",
          Icon: Settings,
        },
        { label: "Activity Logs", to: "/super-admin/activity", Icon: Activity },
        { label: "Profile", to: "/super-admin/profile", Icon: User },
      ],
    },
  ],

  admin: [
    {
      label: "Overview",
      items: [
        { label: "Dashboard", to: "/admin", Icon: LayoutDashboard, end: true },
        { label: "HR Management", to: "/admin/hr", Icon: Users },
        { label: "Jobs", to: "/admin/jobs", Icon: Briefcase },
        { label: "Interviews", to: "/admin/interviews", Icon: CalendarClock },
        { label: "Live Interviews", to: "/admin/live", Icon: Radio },
        { label: "Results", to: "/admin/results", Icon: BarChart3 },
      ],
    },
    {
      label: "Configuration",
      items: [
        {
          label: "Resume Analyzer",
          to: "/admin/resume-analyzer",
          Icon: FileText,
        },
        { label: "Branding", to: "/admin/branding", Icon: Palette },
        { label: "Activity Logs", to: "/admin/activity", Icon: Activity },
        { label: "Profile", to: "/admin/profile", Icon: User },
      ],
    },
  ],

  hr: [
    {
      label: "Hiring",
      items: [
        { label: "Dashboard", to: "/hr", Icon: LayoutDashboard, end: true },
        { label: "Jobs", to: "/hr/jobs", Icon: Briefcase },
        { label: "Interviews", to: "/hr/interviews", Icon: CalendarClock },
        { label: "Live Interviews", to: "/hr/live", Icon: Radio },
        { label: "Results", to: "/hr/results", Icon: BarChart3 },
      ],
    },
    {
      label: "Intelligence",
      items: [
        { label: "Resume Analyzer", to: "/hr/resume-analyzer", Icon: FileText },
        { label: "Profile", to: "/hr/profile", Icon: User },
      ],
    },
  ],
}

/** Flat list of every route a role may reach, for the RBAC route table. */
export function navRoutes(role: Role): string[] {
  return NAVIGATION[role].flatMap((group) => group.items.map((i) => i.to))
}
