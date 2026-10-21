"use client";

import { ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Drawer } from "vaul";
import { Button } from "@/components/ui/button";
import type { CategoryNode } from "@/lib/catalog/queries";

/**
 * The retractable category sidebar.
 *
 * A drill-down, not a mega-menu squeezed onto a phone: one level at a time,
 * with a back step. Vaul gives drag-to-dismiss with a velocity threshold, so a
 * flick closes it and a slow drag does not.
 */
export function CategoryDrawer({
  tree,
  trigger,
}: {
  tree: CategoryNode[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<CategoryNode[]>([]);

  const current = path.length > 0 ? path[path.length - 1].children : tree;
  const heading = path.length > 0 ? path[path.length - 1].name : "Categories";

  function close() {
    setOpen(false);
    // Reset after the exit animation rather than during it, or the list
    // visibly snaps back to the root while sliding away.
    setTimeout(() => setPath([]), 250);
  }

  return (
    <Drawer.Root open={open} onOpenChange={setOpen} direction="left">
      <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col bg-surface-1 shadow-e4 outline-none">
          <div className="flex items-center justify-between gap-2 border-border border-b px-4 py-3">
            <Drawer.Title className="font-semibold text-base">
              {heading}
            </Drawer.Title>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close categories"
              onClick={close}
            >
              <X />
            </Button>
          </div>

          {path.length > 0 ? (
            <button
              type="button"
              onClick={() => setPath((p) => p.slice(0, -1))}
              className="flex items-center gap-2 border-border border-b px-4 py-3 text-left text-secondary-text text-sm"
            >
              <ChevronRight className="size-4 rotate-180" aria-hidden />
              Back
            </button>
          ) : null}

          <nav className="flex-1 overflow-y-auto">
            <ul className="flex flex-col">
              {path.length > 0 ? (
                <li>
                  <Link
                    href={`/c/${path[path.length - 1].slug}`}
                    onClick={close}
                    className="flex items-center justify-between px-4 py-3 font-medium text-accent-text text-sm"
                  >
                    All in {path[path.length - 1].name}
                  </Link>
                </li>
              ) : null}

              {current.map((node) => (
                <li
                  key={node.id}
                  className="border-border border-b last:border-0"
                >
                  {node.children.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setPath((p) => [...p, node])}
                      className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-surface-2"
                    >
                      {node.name}
                      <ChevronRight
                        className="size-4 text-tertiary-text"
                        aria-hidden
                      />
                    </button>
                  ) : (
                    <Link
                      href={`/c/${node.slug}`}
                      onClick={close}
                      className="flex items-center px-4 py-3 text-sm hover:bg-surface-2"
                    >
                      {node.name}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
