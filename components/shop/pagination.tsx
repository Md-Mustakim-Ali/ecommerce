import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Offset pagination.
 *
 * Fine at catalogue size; if a category ever grows past a few thousand
 * products, deep OFFSET scans get expensive and this becomes keyset
 * pagination on (published_at, id). Not a problem worth solving early.
 */
export function Pagination({
  page,
  perPage,
  total,
  searchParams,
  basePath,
}: {
  page: number;
  perPage: number;
  total: number;
  searchParams: Record<string, string | string[] | undefined>;
  basePath: string;
}) {
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  if (lastPage <= 1) return null;

  const href = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || key === "page") continue;
      for (const v of Array.isArray(value) ? value : [value])
        next.append(key, v);
    }
    if (target > 1) next.set("page", String(target));
    const query = next.toString();
    return `${basePath}${query ? `?${query}` : ""}`;
  };

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-4 pt-2"
    >
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        render={page > 1 ? <Link href={href(page - 1)} /> : undefined}
      >
        Previous
      </Button>

      <span className="tabular text-secondary-text text-sm">
        Page {page} of {lastPage}
      </span>

      <Button
        variant="outline"
        size="sm"
        disabled={page >= lastPage}
        render={page < lastPage ? <Link href={href(page + 1)} /> : undefined}
      >
        Next
      </Button>
    </nav>
  );
}
