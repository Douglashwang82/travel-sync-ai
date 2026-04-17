import { describe, it, expect } from "vitest";
import { __test } from "@/services/tracking/fetchers";

const { htmlToText, decodeEntities, absolutize } = __test;

describe("htmlToText", () => {
  it("strips scripts, styles, and comments", () => {
    const out = htmlToText(
      `<html><head><style>a{color:red}</style><script>alert(1)</script></head>
       <body><!-- hidden --><p>Hello <b>world</b></p></body></html>`
    );
    expect(out).toContain("Hello world");
    expect(out).not.toMatch(/alert|color:red|hidden/);
  });

  it("inserts newlines on block-level close tags", () => {
    const out = htmlToText("<p>one</p><p>two</p><p>three</p>");
    expect(out.split("\n").filter(Boolean)).toEqual(["one", "two", "three"]);
  });

  it("decodes common HTML entities", () => {
    expect(decodeEntities("A &amp; B &#39;C&#39; &quot;D&quot;")).toBe(`A & B 'C' "D"`);
  });

  it("preserves CJK content", () => {
    const out = htmlToText("<h1>東京必吃餐廳</h1><p>在澀谷</p>");
    expect(out).toContain("東京必吃餐廳");
    expect(out).toContain("在澀谷");
  });
});

describe("absolutize", () => {
  it("resolves relative URLs against a base", () => {
    expect(absolutize("https://example.com/blog/post", "/img/a.jpg")).toBe(
      "https://example.com/img/a.jpg"
    );
    expect(absolutize("https://example.com/", "https://cdn.x/y.png")).toBe(
      "https://cdn.x/y.png"
    );
  });
});
