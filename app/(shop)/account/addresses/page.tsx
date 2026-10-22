import type { Metadata } from "next";
import Link from "next/link";
import { listAddressesAction } from "@/lib/actions/addresses";
import { AddressBook } from "./address-book";

export const metadata: Metadata = { title: "Addresses" };

export default async function AddressesPage() {
  const addresses = await listAddressesAction();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-semibold text-2xl tracking-tight">Addresses</h1>
        <Link
          href="/account"
          className="text-secondary-text text-sm hover:underline"
        >
          Account
        </Link>
      </div>

      <AddressBook addresses={addresses} />
    </div>
  );
}
