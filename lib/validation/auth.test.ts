import { describe, expect, it } from "vitest";
import {
  classifyIdentifier,
  MIN_PASSWORD_LENGTH,
  signInSchema,
  signUpSchema,
} from "./auth";

const PASSWORD = "correct-horse-battery";

describe("signUpSchema", () => {
  it("accepts a valid sign-up and trims the name", () => {
    const result = signUpSchema.safeParse({
      name: "  Ada Lovelace  ",
      email: "ada@example.com",
      phone: "",
      password: PASSWORD,
    });

    expect(result.success).toBe(true);
    expect(result.data?.name).toBe("Ada Lovelace");
  });

  it("accepts a phone number with no email", () => {
    const result = signUpSchema.safeParse({
      name: "Ada",
      email: "",
      phone: "01712345678",
      password: PASSWORD,
    });

    expect(result.success).toBe(true);
  });

  it("accepts both contacts together", () => {
    const result = signUpSchema.safeParse({
      name: "Ada",
      email: "ada@example.com",
      phone: "+880 171 234 5678",
      password: PASSWORD,
    });

    expect(result.success).toBe(true);
  });

  it("rejects a sign-up with neither contact", () => {
    const result = signUpSchema.safeParse({
      name: "Ada",
      email: "",
      phone: "",
      password: PASSWORD,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(
      /email address or a phone/i,
    );
  });

  it("rejects a number that is not a Bangladeshi mobile", () => {
    const result = signUpSchema.safeParse({
      name: "Ada",
      email: "",
      phone: "0171234",
      password: PASSWORD,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["phone"]);
  });

  it("rejects a password shorter than the configured minimum", () => {
    const result = signUpSchema.safeParse({
      name: "Ada",
      email: "ada@example.com",
      phone: "",
      password: "a".repeat(MIN_PASSWORD_LENGTH - 1),
    });

    expect(result.success).toBe(false);
  });

  it("rejects a malformed email", () => {
    const result = signUpSchema.safeParse({
      name: "Ada",
      email: "not-an-email",
      phone: "",
      password: PASSWORD,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    const result = signUpSchema.safeParse({
      name: "   ",
      email: "ada@example.com",
      phone: "",
      password: PASSWORD,
    });

    expect(result.success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("does not impose a length minimum on the password", () => {
    // Sign-in must accept any existing password, including ones created before
    // MIN_PASSWORD_LENGTH was raised.
    const result = signInSchema.safeParse({
      identifier: "ada@example.com",
      password: "x",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an empty identifier", () => {
    const result = signInSchema.safeParse({ identifier: "  ", password: "x" });

    expect(result.success).toBe(false);
  });
});

describe("classifyIdentifier", () => {
  it.each([
    ["01712345678", "01712345678"],
    ["+8801712345678", "01712345678"],
    ["8801712345678", "01712345678"],
    ["017 1234 5678", "01712345678"],
    ["017-1234-5678", "01712345678"],
  ])("reads %s as the phone %s", (typed, canonical) => {
    expect(classifyIdentifier(typed)).toEqual({
      kind: "phone",
      phone: canonical,
    });
  });

  it.each([
    "ada@example.com",
    "ada+orders@example.co.uk",
    // Not a BD mobile: too short, wrong prefix, or plainly not a number.
    "0171234",
    "01212345678",
    "ada",
  ])("reads %s as an email", (typed) => {
    expect(classifyIdentifier(typed).kind).toBe("email");
  });

  it("trims the address it hands back", () => {
    expect(classifyIdentifier("  ada@example.com  ")).toEqual({
      kind: "email",
      email: "ada@example.com",
    });
  });
});
