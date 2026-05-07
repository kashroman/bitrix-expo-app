import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseExpocentr } from "../../server/parsers/expocentr.ts";
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
