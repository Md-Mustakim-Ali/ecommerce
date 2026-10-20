import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, signInSchema, signUpSchema } from "./auth";

describe("signUpSchema", () => {
  it("accepts a valid sign-up and trims the name", () => {
    const result = signUpSchema.safeParse({
      name: "  Ada Lovelace  ",
      email: "ada@example.com",
      password: "correct-horse-battery",
    });

    expect(result.success).toBe(true);
    expect(result.data?.name).toBe("Ada Lovelace");
  });

  it("rejects a password shorter than the configured minimum", () => {
    const result = signUpSchema.safeParse({
      name: "Ada",
      email: "ada@example.com",
      password: "a".repeat(MIN_PASSWORD_LENGTH - 1),
    });

    expect(result.success).toBe(false);
  });

  it("rejects a malformed email", () => {
    const result = signUpSchema.safeParse({
      name: "Ada",
      email: "not-an-email",
      password: "correct-horse-battery",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    const result = signUpSchema.safeParse({
      name: "   ",
      email: "ada@example.com",
      password: "correct-horse-battery",
    });

    expect(result.success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("does not impose a length minimum on the password", () => {
    // Sign-in must accept any existing password, including ones created before
    // MIN_PASSWORD_LENGTH was raised.
    const result = signInSchema.safeParse({
      email: "ada@example.com",
      password: "x",
    });

    expect(result.success).toBe(true);
  });
});
