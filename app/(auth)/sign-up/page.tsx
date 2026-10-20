import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/guards";
import { safeNextPath } from "@/lib/validation/redirect";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage({
  searchParams,
}: PageProps<"/sign-up">) {
  // See the note in ../sign-in/page.tsx: ?next= is validated server-side so it
  // cannot be turned into an open redirect.
  const next = safeNextPath((await searchParams).next);

  if (await getSession()) redirect(next);

  return <SignUpForm next={next} />;
}
