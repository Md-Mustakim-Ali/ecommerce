import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/guards";
import { safeNextPath } from "@/lib/validation/redirect";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  // Parsed here, on the server, rather than with useSearchParams in the client.
  // Keeps the page out of a client-side-rendering bailout and, more importantly,
  // stops an attacker-supplied ?next= from becoming an open redirect.
  const next = safeNextPath((await searchParams).next);

  if (await getSession()) redirect(next);

  return <SignInForm next={next} />;
}
