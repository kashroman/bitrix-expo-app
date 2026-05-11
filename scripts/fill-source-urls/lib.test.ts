/**
 * Lightweight unit tests for the pure helpers in lib.ts.
 *
 * Run via:  npm test
 * (uses node:test which ships with Node 20.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGGREGATOR_DOMAINS,
  appendParseLogLine,
  buildSearchQueries,
  extractDdgResults,
  isAggregatorDomain,
  isAllowlistedDomain,
  isFutureExhibition,
  normalizeTitleTokens,
  OFFICIAL_ALLOWLIST_DOMAINS,
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

test("isAggregatorDomain matches known aggregators and subdomains", () => {
  assert.equal(isAggregatorDomain("expo77.ru"), true);
  assert.equal(isAggregatorDomain("ict2go.ru"), true);
  assert.equal(isAggregatorDomain("totalexpo.ru"), true);
  assert.equal(isAggregatorDomain("foo.10times.com"), true);
  assert.equal(isAggregatorDomain("vk.com"), true);
  assert.equal(isAggregatorDomain("zr.ru"), true);
  assert.equal(isAggregatorDomain("metobr-expo.ru"), false);
  assert.equal(isAggregatorDomain(""), false);
});

test("AGGREGATOR_DOMAINS includes the user-reported real-world examples", () => {
  for (const d of [
    "expo77.ru",
    "ict2go.ru",
    "totalexpo.ru",
    "expomap.ru",
    "expoclub.ru",
    "10times.com",
    "allevents.in",
    "expotime.ru",
    "proexpo.ru",
    "zr.ru",
  ]) {
    assert.ok(AGGREGATOR_DOMAINS.includes(d), `missing: ${d}`);
  }
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
  assert.ok(official >= 0.85, `official score ${official} should clear apply threshold`);
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

test("aggregator candidates can never clear the apply threshold of 0.85", () => {
  // Even with perfect token match + year + plausible-looking title, a known
  // aggregator domain must stay below the apply minConfidence.
  const tokens = normalizeTitleTokens("Технофорум 2026");
  for (const domain of [
    "ict2go.ru",
    "expo77.ru",
    "totalexpo.ru",
    "expomap.ru",
    "10times.com",
    "zr.ru",
  ]) {
    const s = scoreCandidate(
      {
        url: `https://${domain}/events/some-path/`,
        domain,
        snippet:
          "Технофорум 2026 — международная выставка машиностроения, официальная страница события",
        snippetTitle: "Технофорум 2026 — официальный сайт",
      },
      tokens,
      2026,
    );
    assert.ok(
      s < 0.85,
      `${domain} scored ${s}, should not clear apply threshold`,
    );
  }
});

test("real-world dryRun examples that must be blocked from apply", () => {
  const cases: { title: string; year: number; domain: string; url: string; snippetTitle: string; snippet: string }[] = [
    {
      title: "Технофорум 2026",
      year: 2026,
      domain: "ict2go.ru",
      url: "https://ict2go.ru/events/66073/",
      snippetTitle: "Технофорум 2026",
      snippet: "Технофорум 2026 — выставка",
    },
    {
      title: "Мясная промышленность 2026",
      year: 2026,
      domain: "expo77.ru",
      url: "https://expo77.ru/event/meatindustry/",
      snippetTitle: "Мясная промышленность 2026",
      snippet: "Мясная промышленность",
    },
    {
      title: "СТО Экспо 2026",
      year: 2026,
      domain: "zr.ru",
      url: "https://www.zr.ru/tags/cto-expo-2026/",
      snippetTitle: "СТО Экспо 2026 — За рулём",
      snippet: "Новости по теме",
    },
    {
      title: "Industry Expo 2026",
      year: 2026,
      domain: "totalexpo.ru",
      url: "https://www.totalexpo.ru/expo/6647.aspx",
      snippetTitle: "Industry Expo 2026",
      snippet: "Календарь выставок",
    },
  ];
  for (const c of cases) {
    const tokens = normalizeTitleTokens(c.title);
    const s = scoreCandidate(
      {
        url: c.url,
        domain: c.domain,
        snippet: c.snippet,
        snippetTitle: c.snippetTitle,
      },
      tokens,
      c.year,
    );
    assert.ok(s < 0.85, `${c.domain} for «${c.title}» scored ${s}`);
  }
});

test("real-world official domains pass the 0.85 apply threshold", () => {
  const cases: {
    title: string;
    year: number;
    domain: string;
    url: string;
    snippetTitle: string;
    snippet: string;
  }[] = [
    {
      title: "Металлообработка Москва",
      year: 2026,
      domain: "metobr-expo.ru",
      url: "https://metobr-expo.ru/",
      snippetTitle: "Металлообработка 2026 — официальный сайт",
      snippet: "Международная выставка Металлообработка 2026 в Москве",
    },
    {
      title: "ВодЭкспо 2026",
      year: 2026,
      domain: "vodexpo.ru",
      url: "https://vodexpo.ru/",
      snippetTitle: "ВодЭкспо 2026 — официальный сайт",
      snippet: "Выставка ВодЭкспо 2026",
    },
    {
      title: "Газ.Нефть.Технологии 2026",
      year: 2026,
      domain: "gntexpo.ru",
      url: "https://gntexpo.ru/",
      snippetTitle: "Газ.Нефть.Технологии 2026",
      snippet: "Официальный сайт выставки Газ.Нефть.Технологии",
    },
    {
      title: "Хели Раша 2026",
      year: 2026,
      domain: "helirussia.ru",
      url: "https://helirussia.ru/",
      snippetTitle: "HeliRussia 2026 — официальный сайт",
      snippet: "Международная выставка вертолётной индустрии HeliRussia 2026",
    },
  ];
  for (const c of cases) {
    const tokens = normalizeTitleTokens(c.title);
    const s = scoreCandidate(
      {
        url: c.url,
        domain: c.domain,
        snippet: c.snippet,
        snippetTitle: c.snippetTitle,
      },
      tokens,
      c.year,
    );
    assert.ok(s >= 0.85, `${c.domain} for «${c.title}» scored only ${s}`);
  }
});

test("accreditation subdomains lose to the main event domain", () => {
  const tokens = normalizeTitleTokens("CIPR 2026");
  const accreditation = scoreCandidate(
    {
      url: "https://cipr2026.accreditation.ru/visitor/ru/",
      domain: "cipr2026.accreditation.ru",
      snippet: "Аккредитация на CIPR 2026",
      snippetTitle: "CIPR 2026 — аккредитация",
    },
    tokens,
    2026,
  );
  const official = scoreCandidate(
    {
      url: "https://cipr.ru/",
      domain: "cipr.ru",
      snippet: "Конференция CIPR 2026 — официальный сайт",
      snippetTitle: "CIPR 2026",
    },
    tokens,
    2026,
  );
  assert.ok(
    official > accreditation,
    `official ${official} should beat accreditation ${accreditation}`,
  );
});

test("pickBestCandidate exposes the aggregator flag", () => {
  const tokens = normalizeTitleTokens("Some Expo 2026");
  const best = pickBestCandidate(
    [
      {
        url: "https://expo77.ru/event/some-expo/",
        domain: "expo77.ru",
        snippet: "Some Expo 2026",
        snippetTitle: "Some Expo 2026",
      },
    ],
    tokens,
    2026,
  );
  assert.ok(best);
  assert.equal(best!.aggregator, true);
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
  assert.equal(best!.aggregator, false);
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

test("isAllowlistedDomain matches curated official entries and their subdomains", () => {
  for (const d of [
    "metobr-expo.ru",
    "helirussia.ru",
    "vodexpo.ru",
    "ddexpo.ru",
    "gntexpo.ru",
    "logistika-expo.ru",
    "wire-tradefair.com",
    "mipif.com",
    "expoworldfood.com",
    "gastreet.com",
    "rosupack.com",
    "mitt.ru",
    "intercharm.ru",
    "neftegaz-expo.ru",
    "photonics-expo.ru",
    "expocentr.ru",
    "crocus-expo.ru",
    "kazanforum.ru",
    "cipr.ru",
  ]) {
    assert.ok(isAllowlistedDomain(d), `should allowlist ${d}`);
    assert.ok(isAllowlistedDomain(`www.${d}`), `should strip www. for ${d}`);
    assert.ok(isAllowlistedDomain(`foo.${d}`), `should allow subdomain of ${d}`);
  }
});

test("isAllowlistedDomain rejects the problematic dry-run domains", () => {
  // These are the real-world domains the dry-run kept surfacing that we
  // explicitly do NOT want to write to CRM automatically.
  for (const d of [
    "burservis.ru",
    "fabricators.ru",
    "roscongress.ru",
    "holodindustry.ru",
    "dt.calscenter.ru",
    "igrader.ru",
    "kgs-ural.ru",
    "profiminer.ru",
    "regruss.ru",
    "confs.ru",
    "fontanka.ru",
    "plastinfo.ru",
  ]) {
    assert.equal(isAllowlistedDomain(d), false, `should NOT allowlist ${d}`);
  }
});

test("isAllowlistedDomain accepts the optional extra list", () => {
  assert.equal(isAllowlistedDomain("burservis.ru"), false);
  assert.equal(isAllowlistedDomain("burservis.ru", ["burservis.ru"]), true);
  assert.equal(isAllowlistedDomain("foo.burservis.ru", ["burservis.ru"]), true);
});

test("OFFICIAL_ALLOWLIST_DOMAINS and AGGREGATOR_DOMAINS do not overlap", () => {
  for (const d of OFFICIAL_ALLOWLIST_DOMAINS) {
    assert.equal(
      isAggregatorDomain(d),
      false,
      `${d} is both allowlisted and aggregator`,
    );
  }
});

test("non-allowlisted high-score candidate is correctly identified as ineligible", () => {
  // Simulate a candidate that scores high (would pass the numeric threshold)
  // but lives on a non-allowlisted domain. The score gate alone would let it
  // through; the allowlist gate must block it from apply.
  const tokens = normalizeTitleTokens("Холод-Индустрия 2026");
  const score = scoreCandidate(
    {
      url: "https://holodindustry.ru/",
      domain: "holodindustry.ru",
      snippet: "Официальный сайт Холод-Индустрия 2026",
      snippetTitle: "Холод-Индустрия 2026 — официальный сайт",
    },
    tokens,
    2026,
  );
  // Whether or not the numeric score clears 0.85 here is irrelevant — the
  // allowlist must still block it.
  assert.equal(
    isAllowlistedDomain("holodindustry.ru"),
    false,
    "holodindustry.ru must not be on the allowlist",
  );
  // Sanity: domain is non-aggregator too, so it would otherwise reach the
  // allowlist gate in processItem.
  assert.equal(isAggregatorDomain("holodindustry.ru"), false);
  // Document the score for future debugging — no assertion on its value.
  assert.ok(typeof score === "number");
});

test("allowlisted official domain + high score is apply-eligible", () => {
  // Sanity: the existing real-world official cases score above 0.85 AND are
  // on the allowlist, so the allowlist gate does not regress them.
  const tokens = normalizeTitleTokens("ВодЭкспо 2026");
  const score = scoreCandidate(
    {
      url: "https://vodexpo.ru/",
      domain: "vodexpo.ru",
      snippet: "Официальный сайт ВодЭкспо 2026",
      snippetTitle: "ВодЭкспо 2026 — официальный сайт",
    },
    tokens,
    2026,
  );
  assert.ok(score >= 0.85, `expected >=0.85, got ${score}`);
  assert.equal(isAllowlistedDomain("vodexpo.ru"), true);
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
