import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { getStoreAccess } from "@/lib/auth/access";
import { formatDate } from "@/lib/datetime/format";
import { PLATFORM_CURRENCY } from "@/lib/money/currency";
import { formatMoney } from "@/lib/money/format";
import { customerLabel } from "@/lib/orders/customer-key";
import { listCustomersForStore } from "@/lib/orders/customers";
import { displayPhone } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "Customers" };

/**
 * Who has bought from this store.
 *
 * Derived from orders rather than read from a customers table, because there
 * is no customers table — see lib/orders/customer-key.ts for how two orders
 * are decided to be the same person, and what that cannot do.
 *
 * Every figure is this store's part of an order and nothing else. A buyer whose
 * cart spanned three sellers appears here with only what they spent with this
 * one, and the other two sellers' items are not visible, not counted, and not
 * hinted at. That boundary is enforced in SQL rather than in this component.
 */
export default async function CustomersPage({
  params,
}: PageProps<"/dashboard/[storeId]/customers">) {
  const { storeId } = await params;

  const access = await getStoreAccess(storeId);
  // notFound rather than forbidden: no reason to confirm the store exists to
  // somebody with no access to it.
  if (!access || access.membershipStatus === "none") notFound();
  if (!access.permissions.has("customer.view")) notFound();

  const customers = await listCustomersForStore(storeId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">Customers</h1>
        <p className="text-secondary-text text-sm">
          Everyone who has ordered from this store. Totals are what they spent
          here — never what they spent with other sellers.
        </p>
      </div>

      {customers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border border-dashed p-10 text-center">
          <Users aria-hidden className="size-6 text-tertiary-text" />
          <p className="font-medium text-sm">No customers yet</p>
          <p className="text-secondary-text text-sm">
            Anyone who places an order will appear here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {customers.map((customer) => (
            <li key={customer.key}>
              <Link
                href={`/dashboard/${storeId}/customers/${customer.key}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-surface-1 px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-sm">
                    {customerLabel(customer)}
                  </span>
                  <span className="block truncate text-secondary-text text-xs">
                    {customer.email ??
                      (customer.contactPhone
                        ? displayPhone(customer.contactPhone)
                        : "No contact")}
                  </span>
                </span>

                {/*
                  Whether they have an account, because it changes what a
                  seller can expect. A guest has no order history page to be
                  pointed at and no password to reset — and their orders only
                  join up if they later sign up with the same contact.
                */}
                <Badge variant={customer.buyerId ? "neutral" : "outline"}>
                  {customer.buyerId ? "Account" : "Guest"}
                </Badge>

                <span className="text-right text-xs">
                  <span className="block text-secondary-text">
                    {customer.orderCount}{" "}
                    {customer.orderCount === 1 ? "order" : "orders"}
                  </span>
                  <span className="tabular block font-medium">
                    {formatMoney(customer.spentCents, PLATFORM_CURRENCY)}
                  </span>
                </span>

                <span className="hidden text-right text-tertiary-text text-xs sm:block">
                  <span className="block">
                    Last {formatDate(customer.lastOrderAt)}
                  </span>
                  <span className="block">
                    Since {formatDate(customer.firstOrderAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
