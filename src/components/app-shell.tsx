"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import * as Icons from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { navigationFor, roleLabel, type NavFeatures, type NavSection } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/core/domain/enums";

/** Resolves a lucide icon name from the nav config. */
function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[name] ?? Icons.Circle;
  return <Icon className={className} aria-hidden="true" />;
}

function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function NavLinks({
  sections,
  pathname,
  onNavigate,
}: {
  sections: readonly NavSection[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-6" aria-label="Main">
      {sections.map((section, i) => (
        <div key={section.heading ?? i} className="space-y-1">
          {section.heading ? (
            <p className="text-muted-foreground px-3 pb-1 text-xs font-medium tracking-wide uppercase">
              {section.heading}
            </p>
          ) : null}

          {section.items.map((item) => {
            // Exact match for index routes, prefix match for children — so
            // /admin does not stay highlighted while on /admin/students.
            const active =
              pathname === item.href ||
              (item.href !== "/admin" &&
                item.href !== "/staff" &&
                item.href !== "/student" &&
                pathname.startsWith(`${item.href}/`));

            if (item.disabled) {
              return (
                <span
                  key={item.href}
                  aria-disabled="true"
                  className="text-muted-foreground/60 flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm"
                >
                  <NavIcon name={item.icon} className="size-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.badge ? (
                    <span className="bg-muted rounded px-1.5 py-0.5 text-[10px] font-medium">
                      {item.badge}
                    </span>
                  ) : null}
                </span>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <NavIcon name={item.icon} className="size-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export interface AppShellUser {
  readonly fullName: string;
  readonly role: UserRole;
  readonly tenantName: string;
}

export function AppShell({
  user,
  features,
  signOutAction,
  children,
}: {
  user: AppShellUser;
  /** Tenant toggles that decide which optional links appear. */
  features?: NavFeatures;
  signOutAction: () => Promise<void>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const sections = navigationFor(user.role, features);

  const brand = (
    <div className="flex items-center gap-2.5">
      <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
        <Icons.UtensilsCrossed className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold tracking-tight">{user.tenantName}</p>
        <p className="text-muted-foreground truncate text-xs">Mess OS</p>
      </div>
    </div>
  );

  const accountMenu = (compact: boolean) => (
    <DropdownMenu>
      {/* Base UI composes with `render`, not Radix's `asChild`. The trigger
          already renders a button element, so the styling goes on it directly. */}
      <DropdownMenuTrigger
        className={cn(
          "hover:bg-accent focus-visible:ring-ring/50 flex items-center rounded-lg transition-colors focus-visible:ring-[3px] focus-visible:outline-none",
          compact ? "size-10 justify-center" : "h-auto w-full gap-3 px-2 py-2 text-left",
        )}
        aria-label="Account menu"
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
            {initialsOf(user.fullName)}
          </AvatarFallback>
        </Avatar>
        {compact ? null : (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.fullName}</p>
              <p className="text-muted-foreground truncate text-xs">{roleLabel(user.role)}</p>
            </div>
            <Icons.ChevronsUpDown
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden="true"
            />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* A plain div, not DropdownMenuLabel: that renders Base UI's
            `Menu.GroupLabel`, which throws unless it is inside a `Menu.Group`.
            This is an account header rather than a label for a group of items,
            so there is no group for it to belong to. */}
        <div className="px-1.5 py-1">
          <p className="text-sm font-medium">{user.fullName}</p>
          <p className="text-muted-foreground text-xs">{roleLabel(user.role)}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/change-password" />}>
          <Icons.KeyRound className="size-4" aria-hidden="true" />
          Change password
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        {/* The menu item IS the submit button, so sign-out works without
            JavaScript and keeps the item's keyboard and focus behaviour. */}
        <form action={signOutAction} className="contents">
          <DropdownMenuItem render={<button type="submit" />} className="w-full">
            <Icons.LogOut className="size-4" aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="bg-muted/30 min-h-svh">
      {/* Desktop sidebar */}
      <aside className="border-border bg-background fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r lg:flex">
        <div className="border-border flex h-16 items-center border-b px-4">{brand}</div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks sections={sections} pathname={pathname} />
        </div>
        <div className="border-border border-t p-2">{accountMenu(false)}</div>
      </aside>

      {/* Mobile top bar */}
      <header className="border-border bg-background/95 sticky top-0 z-20 flex h-16 items-center gap-3 border-b px-4 backdrop-blur lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            render={<Button variant="ghost" size="icon" aria-label="Open navigation" />}
          >
            <Icons.Menu className="size-5" aria-hidden="true" />
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="border-border flex h-16 items-center border-b px-4">{brand}</div>
            <div className="flex-1 overflow-y-auto p-3">
              <NavLinks
                sections={sections}
                pathname={pathname}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
            <div className="border-border border-t p-2">{accountMenu(false)}</div>
          </SheetContent>
        </Sheet>

        <div className="min-w-0 flex-1">{brand}</div>

        {/* Also in the top bar, not only inside the drawer. Students are on a
            phone every single time, and signing out should never be two taps
            behind a hamburger. */}
        {accountMenu(true)}
      </header>

      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
