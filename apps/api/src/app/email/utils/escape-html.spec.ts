import { escapeHtml } from "./escape-html";

// RNX-329: user text (a reminder's label) in a mail's HTML.
describe("escapeHtml", () => {
  it("writes & < > \" ' as entities and leaves other text as it is", () => {
    const actual = escapeHtml(`Tom & Jerry's <b>"daily"</b> report`);

    expect(actual).toBe("Tom &amp; Jerry&#39;s &lt;b&gt;&quot;daily&quot;&lt;/b&gt; report");
  });
});
