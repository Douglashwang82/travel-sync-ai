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

const { parseFeedItem, extractBlocks } = __test;

describe("parseFeedItem (RSS 2.0)", () => {
  it("extracts title, link, guid, pubDate, description", () => {
    const block = `
      <title><![CDATA[東京拉麵專題]]></title>
      <link>https://blog.example.com/ramen</link>
      <guid>https://blog.example.com/ramen</guid>
      <pubDate>Mon, 14 Apr 2026 09:00:00 +0000</pubDate>
      <description><![CDATA[<p>今年新開的 10 家必吃拉麵</p>]]></description>
    `;
    const item = parseFeedItem(block, false, "https://blog.example.com/feed");
    expect(item.title).toBe("東京拉麵專題");
    expect(item.url).toBe("https://blog.example.com/ramen");
    expect(item.external_id).toBe("https://blog.example.com/ramen");
    expect(item.published_at).toBe(new Date("2026-04-14T09:00:00Z").toISOString());
    expect(item.body_text).toContain("今年新開的 10 家必吃拉麵");
  });

  it("falls back to url when guid is missing, and resolves relative link", () => {
    const block = `<title>Hello</title><link>/posts/1</link>`;
    const item = parseFeedItem(block, false, "https://ex.com/feed.xml");
    expect(item.url).toBe("https://ex.com/posts/1");
    expect(item.external_id).toBe("https://ex.com/posts/1");
  });
});

describe("parseFeedItem (Atom)", () => {
  it("extracts from <entry> with href link and published", () => {
    const block = `
      <id>tag:example.com,2026:entry/42</id>
      <title>Kyoto Spring Guide</title>
      <link rel="alternate" href="https://example.com/kyoto"/>
      <published>2026-04-10T00:00:00Z</published>
      <summary>Cherry blossom routes and ryokan picks.</summary>
    `;
    const item = parseFeedItem(block, true, "https://example.com/atom");
    expect(item.title).toBe("Kyoto Spring Guide");
    expect(item.url).toBe("https://example.com/kyoto");
    expect(item.external_id).toBe("tag:example.com,2026:entry/42");
    expect(item.published_at).toBe("2026-04-10T00:00:00.000Z");
    expect(item.body_text).toContain("Cherry blossom");
  });
});

describe("extractBlocks", () => {
  it("pulls multiple items out of an RSS document", () => {
    const xml = `<rss><channel>
      <item><title>A</title></item>
      <item><title>B</title></item>
      <item><title>C</title></item>
    </channel></rss>`;
    const blocks = extractBlocks(xml, "item");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("A");
  });
});

const { parseYouTubeUrl } = __test;

describe("parseYouTubeUrl", () => {
  it("parses direct channel IDs", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/channel/UCabcdef123")).toEqual({
      kind: "channel",
      channelId: "UCabcdef123",
    });
  });

  it("parses @handle URLs (with and without trailing path)", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/@TravelWithJ")).toEqual({
      kind: "handle",
      handle: "TravelWithJ",
    });
    expect(parseYouTubeUrl("https://youtube.com/@TravelWithJ/videos")).toEqual({
      kind: "handle",
      handle: "TravelWithJ",
    });
  });

  it("treats /c/ vanity URLs as handles", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/c/SomeChannel")).toEqual({
      kind: "handle",
      handle: "SomeChannel",
    });
  });

  it("parses legacy /user/ URLs", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/user/legacyname")).toEqual({
      kind: "username",
      username: "legacyname",
    });
  });

  it("returns null for non-YouTube URLs and unrecognised paths", () => {
    expect(parseYouTubeUrl("https://example.com/@foo")).toBeNull();
    expect(parseYouTubeUrl("https://www.youtube.com/")).toBeNull();
    expect(parseYouTubeUrl("not a url")).toBeNull();
  });
});
