/**
 * Lightweight unit tests for the pure helpers in lib.ts.
 *
 * Run via:  npm test
 * (uses node:test which ships with Node 20.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendParseLogLine,
  buildSearchQueries,
  extractDdgResults,
  isFutureExhibition,
  normalizeTitleTokens,
  pickBestCandidate,
  resolveDdgHref,
  scoreCandidate,
} from "./lib.ts";

test("normalizeTitleTokens drops stop-words and short tokens", () => {
  const tokens = normalizeTitleTokens("Международная выставка Rosupack 2026");
  assert.ok(tokens.includes("rosupack"));
  assert.ok(tokens.includes("2026"));
  assert.ok(!tokens.includes("выставка"));
  assert.ok(!tokens.includes("международная"));
});

test("buildSearchQueries de-duplicates and includes year when present", () => {
  const qs = buildSearchQueries("MITT", 2026);
  assert.ok(qs.length >= 2);
  assert.ok(qs.some((q) => q.includes("2026")));
  assert.equal(new Set(qs).size, qs.length);
});

test("isFutureExhibition is strict about ISO dates", () => {
  assert.equal(isFutureExhibition("2030-01-01", "2026-05-11"), true);
  assert.equal(isFutureExhibition("2026-05-11T10:00:00Z", "2026-05-11"), true);
  assert.equal(isFutureExhibition("2024-01-01", "2026-05-11"), false);
  assert.equal(isFutureExhibition(null, "2026-05-11"), false);
  assert.equal(isFutureExhibition("", "2026-05-11"), false);
  assert.equal(isFutureExhibition("not-a-date", "2026-05-11"), false);
});

test("appendParseLogLine keeps only the last N lines", () => {
  let log = "";
  for (let i = 1; i <= 15; i++) {
    log = appendParseLogLine(log, `line ${i}`, 10);
  }
  const out = log.split("\n");
  assert.equal(out.length, 10);
  assert.equal(out[0], "line 6");
  assert.equal(out[9], "line 15");
});

test("scoreCandidate prefers known official domains over aggregators", () => {
  const tokens = normalizeTitleTokens("Rosupack 2026");
  const official = scoreCandidate(
    {
      url: "https://rosupack.com/",
      domain: "rosupack.com",
      snippet: "Официальный сайт международной выставки Rosupack 2026",
      snippetTitle: "Rosupack 2026 — официальный сайт",
    },
    tokens,
    2026,
  );
  const aggregator = scoreCandidate(
    {
      url: "https://expomap.ru/expo/rosupack-2026/",
      domain: "expomap.ru",
      snippet: "Rosupack 2026 на ExpoMap",
      snippetTitle: "Rosupack 2026",
    },
    tokens,
    2026,
  );
  assert.ok(official > aggregator, `${official} should beat ${aggregator}`);
  assert.ok(official >= 0.75, `official score ${official} should clear threshold`);
});

test("scoreCandidate penalises social networks and PDFs", () => {
  const tokens = normalizeTitleTokens("MITT 2026");
  const vk = scoreCandidate(
    {
      url: "https://vk.com/mitt",
      domain: "vk.com",
      snippet: "MITT 2026",
      snippetTitle: "MITT — ВКонтакте",
    },
    tokens,
    2026,
  );
  assert.ok(vk < 0.5, `vk score ${vk} should be heavily penalised`);
});

test("pickBestCandidate returns the highest-scoring candidate", () => {
  const tokens = normalizeTitleTokens("Intercharm 2026");
  const best = pickBestCandidate(
    [
      {
        url: "https://10times.com/intercharm",
        domain: "10times.com",
        snippet: "",
        snippetTitle: "Intercharm",
      },
      {
        url: "https://intercharm.ru/",
        domain: "intercharm.ru",
        snippet: "Официальный сайт Intercharm 2026",
        snippetTitle: "Intercharm 2026",
      },
    ],
    tokens,
    2026,
  );
  assert.ok(best);
  assert.equal(best!.domain, "intercharm.ru");
});

test("resolveDdgHref unwraps DuckDuckGo redirect URLs", () => {
  const wrapped =
    "//duckduckgo.com/l/?uddg=" + encodeURIComponent("https://rosupack.com/");
  assert.equal(resolveDdgHref(wrapped), "https://rosupack.com/");
  assert.equal(
    resolveDdgHref("https://example.org/page"),
    "https://example.org/page",
  );
  assert.equal(resolveDdgHref(""), "");
});

test("extractDdgResults parses anchors and snippets", () => {
  const wrapped =
    "//duckduckgo.com/l/?uddg=" + encodeURIComponent("https://rosupack.com/");
  const html = `
    <div class="result">
      <a class="result__a" href="${wrapped}">Rosupack 2026 &mdash; официальный сайт</a>
      <a class="result__snippet" href="${wrapped}">Международная выставка Rosupack 2026.</a>
    </div>
  `;
  const out = extractDdgResults(html);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, "https://rosupack.com/");
  assert.match(out[0].title, /Rosupack 2026/);
  assert.match(out[0].snippet, /Международная выставка/);
});
