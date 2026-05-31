import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/passwords";

describe("password hashing", () => {
  it("hashes with the configured scrypt params and verifies the password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("returns false for unsupported scrypt params", async () => {
    const encoded = [
      "scrypt",
      "999999999999",
      "8",
      "1",
      Buffer.from("salt").toString("base64"),
      Buffer.alloc(64).toString("base64"),
    ].join("$");

    await expect(verifyPassword("password", encoded)).resolves.toBe(false);
  });
});
