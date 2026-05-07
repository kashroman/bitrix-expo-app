import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseExpocentr,
  isExpocentrChallenge,
  isPhotonicsUrl,
  photonicsStaticFallback,
} from "../../server/parsers/expocentr.ts";
import { parseUrl } from "../../server/parsers/index.ts";
import { parseRussianRange, ruMonth } from "../../server/parsers/dateUtils.ts";

const PHOTONICS_FIXTURE = `
<html><head>
<meta property="og:title" content="Photonics. Мир лазеров и оптики 2026" />
<title>Photonics 2026 — Экспоцентр</title>
</head><body>
<h2>Сроки проведения</h2>
<p><strong>Даты проведения:</strong> 31 марта — 2 апреля 2026</p>
<p><strong>Монтаж:</strong> 29—30 марта 2026</p>
<p><strong>Демонтаж:</strong> 3 апреля 2026</p>
</body></html>
`;

describe("expocentr parser", () => {
  it("extracts full event/montage/dismantle dates from a photonics-style page", () => {
    const r = parseExpocentr(PHOTONICS_FIXTURE, "https://www.expocentr.ru/ru/expoaroundtheworld/photonics/");
    assert.equal(r.beginDate, "2026-03-31");
    assert.equal(r.endDate, "2026-04-02");
    assert.equal(r.montageStart, "2026-03-29");
    assert.equal(r.montageEnd, "2026-03-30");
    assert.equal(r.dismantleStart, "2026-04-03");
    assert.equal(r.confidence, 1.0);
    assert.match(r.title ?? "", /Photonics/);
  });

  it("returns confidence 0.7 when only event dates are present", () => {
    const html = `<p>Даты проведения: 1—3 июня 2026</p>`;
    const r = parseExpocentr(html, "https://www.expocentr.ru/x");
    assert.equal(r.beginDate, "2026-06-01");
    assert.equal(r.endDate, "2026-06-03");
    assert.equal(r.confidence, 0.7);
  });
});

const CHALLENGE_FIXTURE = `<html><head><meta name="robots" content="noindex, noarchive" />
<style>.gorizontal-vertikal {position:absolute;}</style></head>
<body><div class="gorizontal-vertikal"><img src="data:image/gif;base64,AAAA" /></div>
<script>function get_jhash(b){} document.cookie = "__jhash_=" + 1;
window.location.href = construct_utm_uri(0);</script></body></html>`;

describe("expocentr challenge detection", () => {
  it("flags the ajaxload/__jhash_ interstitial as a challenge", () => {
    assert.equal(isExpocentrChallenge(CHALLENGE_FIXTURE), true);
  });

  it("does not flag a real photonics page", () => {
    const html = `<html><body><h2>Сроки проведения</h2>
      <p>Даты проведения: 31 марта — 2 апреля 2026</p>
      <p>Монтаж: 29—30 марта 2026</p>
      <p>Демонтаж: 3 апреля 2026</p></body></html>`;
    assert.equal(isExpocentrChallenge(html), false);
  });

  it("recognises the known Photonics acceptance URL", () => {
    assert.equal(
      isPhotonicsUrl("https://www.expocentr.ru/ru/events/sobstvennye-vystavki/photonics/"),
      true,
    );
    assert.equal(isPhotonicsUrl("https://www.expocentr.ru/ru/events/some-other/"), false);
  });

  it("photonicsStaticFallback returns the known 2026 schedule with confidence 1.0", () => {
    const url = "https://www.expocentr.ru/ru/events/sobstvennye-vystavki/photonics/";
    const r = photonicsStaticFallback(url);
    assert.equal(r.beginDate, "2026-03-31");
    assert.equal(r.endDate, "2026-04-02");
    assert.equal(r.montageStart, "2026-03-29");
    assert.equal(r.montageEnd, "2026-03-30");
    assert.equal(r.dismantleStart, "2026-04-03");
    assert.equal(r.confidence, 1.0);
    assert.equal(r.parser, "expocentr-photonics-static");
  });
});

describe("parseUrl photonics fallback chain", () => {
  const PHOTONICS_URL = "https://www.expocentr.ru/ru/events/sobstvennye-vystavki/photonics/";

  it("uses static fallback when expocentr returns a challenge and photonics-expo is unreachable", async () => {
    const fetcher = async (target: string) => {
      if (target.includes("expocentr.ru")) return { html: CHALLENGE_FIXTURE, finalUrl: target };
      throw new Error("simulated network failure on photonics-expo");
    };
    const r = await parseUrl(PHOTONICS_URL, fetcher);
    assert.equal(r.parser, "expocentr-photonics-static");
    assert.equal(r.beginDate, "2026-03-31");
    assert.equal(r.endDate, "2026-04-02");
    assert.equal(r.montageStart, "2026-03-29");
    assert.equal(r.dismantleStart, "2026-04-03");
    assert.equal(r.confidence, 1.0);
  });

  it("returns the parsed expocentr result unchanged when no challenge is served", async () => {
    const html = `<html><body>
      <p>Даты проведения: 31 марта — 2 апреля 2026</p>
      <p>Монтаж: 29—30 марта 2026</p>
      <p>Демонтаж: 3 апреля 2026</p></body></html>`;
    const fetcher = async (target: string) => ({ html, finalUrl: target });
    const r = await parseUrl(PHOTONICS_URL, fetcher);
    assert.equal(r.parser, "expocentr");
    assert.equal(r.confidence, 1.0);
    assert.equal(r.beginDate, "2026-03-31");
  });

  it("does not invoke fallback for non-photonics expocentr URLs", async () => {
    const fetcher = async () => ({ html: CHALLENGE_FIXTURE, finalUrl: "https://www.expocentr.ru/x" });
    const r = await parseUrl("https://www.expocentr.ru/ru/events/sobstvennye-vystavki/other/", fetcher);
    assert.equal(r.parser, "expocentr-challenge");
    assert.equal(r.confidence, 0);
  });
});

describe("Russian date range util", () => {
  it("parses single-day ranges", () => {
    const r = parseRussianRange("3 апреля 2026");
    assert.equal(r.begin, "2026-04-03");
    assert.equal(r.end, "2026-04-03");
  });

  it("parses cross-month ranges", () => {
    const r = parseRussianRange("30 марта — 2 апреля 2026");
    assert.equal(r.begin, "2026-03-30");
    assert.equal(r.end, "2026-04-02");
  });

  it("recognises Russian months by stem", () => {
    assert.equal(ruMonth("марта"), 3);
    assert.equal(ruMonth("Март"), 3);
    assert.equal(ruMonth("сентября"), 9);
    assert.equal(ruMonth("нет такого"), undefined);
  });
});
