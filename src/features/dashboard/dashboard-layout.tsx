import * as React from "react"
import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { formatDistanceToNow } from "date-fns"
import {
  Bell,
  LogOut,
  Menu,
  Moon,
  PanelLeft,
  PanelRight,
  Settings,
  Sun,
  User as UserIcon,
  X,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ApiImage } from "@/components/shared/api-image"
import { useTheme } from "@/components/theme-provider"
import { NAVIGATION } from "@/config/navigation"
import { useBranding, useCompanyAuditLogs } from "@/services/admin"
import { usePlatformAuditLogs } from "@/services/super-admin"
import { useCurrentUser } from "@/features/auth/auth-context"
import { useSignOut } from "@/features/auth/use-sign-out"
import { ROLE_HOME, ROLE_LABEL } from "@/features/auth/types"
import { cn } from "@/lib/utils"


function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

/**
 * Roles whose audit log they can actually read. HR's console has no activity
 * feed behind it, so they get no bell rather than an endless spinner over a
 * 403.
 */
const CAN_SEE_ACTIVITY: ReadonlySet<string> = new Set(["super_admin", "admin"])

/**
 * The product's own mark, shown when the company hasn't uploaded a logo.
 *
 * Collapses to the square alone in the narrow sidebar, where the wordmark has
 * nowhere to go.
 */
function DefaultMark({ collapsed }: { collapsed?: boolean }) {
  return (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-blue text-xs font-bold text-white">
        R
      </span>
      {!collapsed ? (
        <span className="truncate">
          Recruiter<span className="text-brand-pink">AI</span>
        </span>
      ) : null}
    </>
  )
}

/**
 * The workspace's logo in the chrome, or the product's mark when there is none.
 *
 * A company that uploaded a logo gets **only** that logo — no "RecruiterAI"
 * beside it. The uploaded file almost always contains the company's own name,
 * so pairing the two reads as two brands sharing a header.
 *
 * Read from `GET /api/company/branding` for **Admin and HR both**, which is
 * what the API spec promises for this one endpoint: "readable by any of the
 * client's staff, admin and HR alike, so every dashboard renders the client's
 * look from the same call" (§5, §7). Writes stay admin-only, and the super
 * admin has no company to ask about, so the query is off for them.
 *
 * ⚠️ A deployment that gates this *read* like the writes answers HR with
 * "Requires a company administrator account". That is a server-side deviation
 * from the documented contract, not something this component can work around:
 * the public `GET /api/branding?company=<slug>` needs a slug the app is never
 * told, and guessing it from the company's display name would quietly serve the
 * *platform* logo to any tenant that has since been renamed. So HR simply falls
 * back to {@link DefaultMark} until the backend opens the read.
 */
function BrandMark({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const user = useCurrentUser()
  const branding = useBranding(user.role !== "super_admin")
  const logoUrl = branding.data?.logoUrl ?? null

  return (
    <NavLink
      to={ROLE_HOME[user.role]}
      onClick={onNavigate}
      className="flex items-center gap-2 overflow-hidden font-heading text-base font-bold whitespace-nowrap"
    >
      {logoUrl ? (
        <ApiImage
          src={logoUrl}
          alt={branding.data?.appName || "Workspace logo"}
          className={cn(
            "shrink-0 object-contain",
            // Free to be as wide as it needs within the rail; a logo squeezed
            // into a square is unreadable at this size.
            collapsed ? "size-8" : "h-8 w-auto max-w-40"
          )}
          fallback={<DefaultMark collapsed={collapsed} />}
          // Holding the space keeps the product mark from flashing up for the
          // length of one request every time the chrome mounts.
          pending={<span className="h-8 w-8" />}
        />
      ) : (
        <DefaultMark collapsed={collapsed} />
      )}
    </NavLink>
  )
}

/** Sidebar contents. Shared by the desktop rail and the mobile overlay. */
function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const user = useCurrentUser()

  return (
    <nav className="flex flex-col gap-6 p-3" aria-label="Dashboard">
      {NAVIGATION[user.role].map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          {!collapsed ? (
            <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {group.label}
            </p>
          ) : null}

          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  collapsed && "justify-center px-2",
                  isActive
                    ? "bg-brand-blue/10 text-brand-blue"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )
              }
            >
              <item.Icon className="size-4 shrink-0" />
              {!collapsed ? (
                <span className="truncate">{item.label}</span>
              ) : null}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}

/**
 * Recent-activity panel behind the bell icon, from the audit log.
 *
 * Which log depends on the role: a super admin reads the platform's, an Admin
 * their own company's. **HR has neither** — `/api/company/audit-logs` answers
 * "Requires a company administrator account" like the rest of `/api/company/*`
 * — so the bell isn't rendered for them at all. See {@link CAN_SEE_ACTIVITY}.
 */
function NotificationsMenu() {
  const user = useCurrentUser()
  const isPlatform = user.role === "super_admin"

  // Both hooks are called so hook order stays stable, but only the one the
  // role is allowed to read is enabled — the other 403s. Passing a different
  // limit is not enough; React Query fires the request either way.
  const platform = usePlatformAuditLogs(8, isPlatform)
  const company = useCompanyAuditLogs(8, user.role === "admin")
  const { data, isLoading } = isPlatform ? platform : company

  const entries = data ?? []
  const unread = Math.min(entries.length, 9)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Notifications" />
        }
      >
        <span className="relative">
          <Bell />
          {unread > 0 ? (
            <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-brand-pink text-[9px] font-bold text-white">
              {unread}
            </span>
          ) : null}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-sm font-medium">
          Recent activity
        </div>
        <div className="max-h-80 overflow-y-auto px-3 py-2">
          {isLoading ? (
            <p className="py-3 text-sm text-muted-foreground">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              Nothing recorded yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5 py-1">
              {entries.map((entry, i) => (
                <li key={`${entry.createdAt}-${i}`} className="text-sm">
                  <p className="font-medium">
                    {entry.action.replace(/[._-]+/g, " ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {entry.target || entry.actorEmail} ·{" "}
                    {formatDistanceToNow(new Date(entry.createdAt), {
                      addSuffix: true,
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The signed-in account, shown at the foot of the sidebar. Collapses to just
 * the avatar when the sidebar is narrow.
 */
function ProfileMenu({ collapsed }: { collapsed?: boolean }) {
  const user = useCurrentUser()
  const signOut = useSignOut()
  const navigate = useNavigate()
  const roleHome = ROLE_HOME[user.role]

  const go = (suffix: string) =>
    navigate(`${roleHome}/${suffix}`.replace("//", "/"))

  // Only offer Settings where the role's navigation actually has a page for it.
  const hasSettings = NAVIGATION[user.role].some((group) =>
    group.items.some((item) => item.to.endsWith("/settings"))
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            aria-label="Account menu"
            className={cn(
              "h-auto w-full py-2",
              collapsed ? "justify-center px-2" : "justify-start px-2"
            )}
          />
        }
      >
        <Avatar className="size-7 shrink-0">
          <AvatarFallback className="text-xs">
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
        {!collapsed ? (
          <span className="flex min-w-0 flex-col items-start">
            <span className="w-full truncate text-sm font-medium">
              {user.name}
            </span>
            <span className="w-full truncate text-xs font-normal text-muted-foreground">
              {ROLE_LABEL[user.role]}
            </span>
          </span>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" className="w-56">
        {/* Base UI requires a GroupLabel to live inside a Group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span className="font-medium">{user.name}</span>
              <span className="text-xs text-muted-foreground">
                {user.email}
              </span>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => go("profile")}>
          <UserIcon />
          Profile
        </DropdownMenuItem>
        {hasSettings ? (
          <DropdownMenuItem onClick={() => go("settings")}>
            <Settings />
            Settings
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => void signOut()}
        >
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The one dashboard chrome for every role: collapsible sidebar, notifications,
 * theme toggle, and the account menu in the sidebar footer. Role differences
 * come entirely from the navigation config and the routed page.
 */
export function DashboardLayout() {
  const user = useCurrentUser()
  const { theme, setTheme } = useTheme()

  const [collapsed, setCollapsed] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)

  const isDark = theme === "dark"

  return (
    <div className="flex min-h-svh bg-muted/30">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-svh shrink-0 flex-col border-r bg-background transition-[width] duration-200 lg:flex",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center gap-2 border-b px-4",
            collapsed && "justify-center px-2"
          )}
        >
          <BrandMark collapsed={collapsed} />
        </div>

        <ScrollArea className="flex-1">
          <SidebarNav collapsed={collapsed} />
        </ScrollArea>

        {/* Account lives at the foot of the sidebar, where the collapse
            control used to sit. */}
        <div className="border-t p-3">
          <ProfileMenu collapsed={collapsed} />
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-background shadow-xl">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <BrandMark onNavigate={() => setMobileOpen(false)} />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
              >
                <X />
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </ScrollArea>
          </div>
        </div>
      ) : null}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur-md">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
            className="lg:hidden"
          >
            <Menu />
          </Button>

          {/* The sidebar — and with it the logo — is hidden below `lg`, so the
              top bar carries the mark itself at those widths. */}
          <span className="lg:hidden">
            <BrandMark collapsed />
          </span>

          {/* Sidebar toggle sits where the search box used to be — icon only. */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden lg:inline-flex"
          >
            {/* The icon shows the direction the panel will move, so the two
                states are told apart by shape rather than by a rotation. */}
            {collapsed ? <PanelRight /> : <PanelLeft />}
          </Button>

          <div className="ml-auto flex items-center gap-1">
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {ROLE_LABEL[user.role]}
            </Badge>

            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                isDark ? "Switch to light mode" : "Switch to dark mode"
              }
              onClick={() => setTheme(isDark ? "light" : "dark")}
            >
              {isDark ? <Sun /> : <Moon />}
            </Button>

            {CAN_SEE_ACTIVITY.has(user.role) ? <NotificationsMenu /> : null}
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
