import { z } from "zod";
import { normaliseBdMobile } from "./phone";

/**
 * Shared between the client form and the server. Parse, don't cast.
 * `minPasswordLength` in lib/auth/index.ts must match MIN_PASSWORD_LENGTH.
 */
export const MIN_PASSWORD_LENGTH = 12;

const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `At least ${MIN_PASSWORD_LENGTH} characters`)
  .max(128, "Password is too long");

/**
 * Registration takes an email, a phone number, or both.
 *
 * Both is worth encouraging rather than merely allowing: each contact claims
 * the guest orders placed with it, so a buyer who gives both gets one history
 * instead of two halves. It is also the only way to recover an account when
 * one channel is lost.
 */
export const signUpSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter your name")
      .max(80, "Name is too long"),
    email: z.union([z.email("Enter a valid email address"), z.literal("")]),
    phone: z.string().trim().max(40),
    password,
  })
  .superRefine((input, ctx) => {
    if (!input.email && !input.phone) {
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: "Enter an email address or a phone number.",
      });
      return;
    }

    if (input.phone && !normaliseBdMobile(input.phone)) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Enter a valid mobile number, like 01712345678.",
      });
    }
  });

/**
 * Signing in takes one identifier, and works out which it is.
 *
 * One field rather than a chooser: somebody who registered months ago should
 * not have to remember which of the two they used. A string that reduces to a
 * Bangladeshi mobile is treated as one, and everything else is tried as an
 * email — the two shapes cannot collide, since no email parses as 01XXXXXXXXX.
 */
export const signInSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your email or phone number"),
  password: z.string().min(1, "Enter your password"),
});

export type SignInIdentifier =
  | { kind: "phone"; phone: string }
  | { kind: "email"; email: string };

export function classifyIdentifier(input: string): SignInIdentifier {
  const phone = normaliseBdMobile(input);
  return phone
    ? { kind: "phone", phone }
    : { kind: "email", email: input.trim() };
}

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
