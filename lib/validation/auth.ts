import { z } from "zod";

/**
 * Shared between the client form and the server. Parse, don't cast.
 * `minPasswordLength` in lib/auth/index.ts must match MIN_PASSWORD_LENGTH.
 */
export const MIN_PASSWORD_LENGTH = 12;

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80, "Name is too long"),
  email: z.email("Enter a valid email address"),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `At least ${MIN_PASSWORD_LENGTH} characters`)
    .max(128, "Password is too long"),
});

export const signInSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
