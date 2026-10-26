"use client";

import {
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Shield,
  Store,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { signOut } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

/**
 * The account menu, shared by every shell.
 *
 * It exists because the dashboard and the admin panel had no way out. Neither
 * offered sign-out, and neither linked back to the storefront or the profile —
 * so once you were in a dashboard the only exit was editing the URL. That is
 * not a small annoyance on a shared machine, where the way you end a session
 * is the way you protect an account.
 *
 * The same component everywhere, so the way you leave is in the same place
 * whichever surface you are on.
 */

export type MenuStore = { id: string; name: string; slug: string };

export function AccountMenu({
  name,
  email,
  stores,
  isStaff,
  /** Highlights where you already are, so the menu says something. */
  current,
  className,
}: {
  name: string;
  email: string;
  stores: MenuStore[];
  isStaff: boolean;
  current?:
    | { kind: "store"; id: string }
    | { kind: "admin" }
    | { kind: "shop" };
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Closes on an outside click or Escape. A menu that traps you is worse than
  // no menu, and this one is often the last thing between a person and a
  // shared machine.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /**
   * Where you are, read from the URL unless a caller says otherwise.
   *
   * The seller shell sits above the [storeId] segment, so it cannot know which
   * store is open and cannot pass it down. Reading the path means the menu
   * marks the right store anyway, and there is nothing to keep in sync.
   */
  const here =
    current ??
    (pathname.startsWith("/admin")
      ? ({ kind: "admin" } as const)
      : pathname.startsWith("/dashboard/")
        ? ({ kind: "store", id: pathname.split("/")[2] } as const)
        : pathname.startsWith("/account")
          ? ({ kind: "shop" } as const)
          : undefined);

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || email[0]?.toUpperCase();

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "flex items-center gap-2 rounded-full border border-border bg-surface-1 py-1 pr-2 pl-1",
          "pressable transition-colors hover:bg-surface-2",
          "outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-3 font-medium text-xs">
          {initials}
        </span>
        <span className="hidden max-w-32 truncate text-sm sm:inline">
          {name}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3.5 text-tertiary-text transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute top-full right-0 z-50 mt-2 w-64 origin-top-right",
            "rounded-xl border border-border bg-surface-1 p-1.5 shadow-e3",
          )}
        >
          <div className="px-2.5 py-2">
            <p className="truncate font-medium text-sm">{name}</p>
            <p className="truncate text-tertiary-text text-xs">{email}</p>
          </div>

          <Separator />

          <Item
            href="/account"
            icon={User}
            label="Your profile"
            active={here?.kind === "shop"}
            onNavigate={() => setOpen(false)}
          />
          <Item
            href="/"
            icon={Store}
            label="Back to the marketplace"
            onNavigate={() => setOpen(false)}
          />

          {stores.length > 0 ? (
            <>
              <Separator />
              <p className="px-2.5 pt-1.5 pb-1 text-tertiary-text text-xs">
                {stores.length === 1 ? "Your store" : "Your stores"}
              </p>
              {/*
                Every store is listed rather than only the first. Someone with
                access to three had no way to switch between them without
                going back out to /dashboard and in again.
              */}
              {stores.map((store) => (
                <Item
                  key={store.id}
                  href={`/dashboard/${store.id}`}
                  icon={LayoutDashboard}
                  label={store.name}
                  active={here?.kind === "store" && here.id === store.id}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </>
          ) : null}

          {isStaff ? (
            <>
              <Separator />
              <Item
                href="/admin"
                icon={Shield}
                label="Admin panel"
                active={here?.kind === "admin"}
                onNavigate={() => setOpen(false)}
              />
            </>
          ) : null}

          <Separator />

          <button
            type="button"
            role="menuitem"
            disabled={pending}
            onClick={async () => {
              await signOut();
              startTransition(() => {
                router.push("/");
                router.refresh();
              });
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm",
              "text-critical transition-colors hover:bg-critical-muted",
              "outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
            )}
          >
            <LogOut aria-hidden className="size-4" />
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Separator() {
  return <div aria-hidden className="my-1.5 h-px bg-border" />;
}

function Item({
  href,
  icon: Icon,
  label,
  active,
  onNavigate,
}: {
  href: string;
  icon: typeof User;
  label: string;
  active?: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
        "outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
        active ? "bg-surface-2 font-medium" : "hover:bg-surface-2",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0 text-secondary-text" />
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  );
}
