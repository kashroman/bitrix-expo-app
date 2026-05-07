import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { appConfigSchema } from "@shared/schema";
import { z } from "zod";
import { parseUrl } from "./parsers/index.js";
import {
  bitrixConfigSummary,
  BitrixWebhookRequiredError,
  hasWebhook,
  bxListAll,
} from "./lib/bitrix.js";
import {
  EXPO_DATE_FIELDS,
  EXPO_ENTITY_TYPE_ID,
  SMART_FIELDS,
  pickField,
} from "./lib/expoFields.js";
import {
  appendParseLog,
  buildCreatePayload,
  buildParseLogLine,
  computeEnrichmentDiff,
  crmCreateExpo,
  crmGetExpo,
  crmUpdateExpo,
  describeChange,
  maybeFillCalculated,
  timelineComment,
} from "./lib/smartEnrichment.js";

const urlBody = z.object({ url: z.string().url() });
const confirmBody = z.object({
  url: z.string().url(),
  title: z.string().min(1).optional(),
  fillCalculated: z.boolean().optional(),
});
const manualBody = z.object({
  title: z.string().min(1),
  url: z.string().url().optional(),
  beginDate: z.string().optional(),
  endDate: z.string().optional(),
});

function bitrixError(res: Response, err: unknown) {
  if (err instanceof BitrixWebhookRequiredError) {
    return res.status(503).json({
      error: "webhook-required",
      message: err.message,
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[smart-enrichment] error:", err);
  return res.status(500).json({ error: "internal", message });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  app.get("/api/app-config", (_req, res) => {
    const config = appConfigSchema.parse({
      portalUrl: process.env.BITRIX_PORTAL_URL ?? "https://b24-5syfa7.bitrix24.ru",
      company: process.env.COMPANY_NAME ?? "interpro.pro",
      appName: "Календарь выставок",
      placements: {
        dealTab: "CRM_DEAL_DETAIL_TAB",
        dynamicTabTemplate: "CRM_DYNAMIC_{entityTypeId}_DETAIL_TAB",
        calendar: "CRM_ANALYTICS_MENU",
      },
    });

    res.json(config);
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, app: "bitrix-expo-app" });
  });

  app.get("/api/smart-config", (_req, res) => {
    res.json({
      ...bitrixConfigSummary(),
      entityTypeId: EXPO_ENTITY_TYPE_ID,
      fields: { ...EXPO_DATE_FIELDS, ...SMART_FIELDS },
    });
  });

  app.post("/api/smart-add", async (req: Request, res: Response) => {
    const parsed = urlBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "bad-request", message: parsed.error.message });
    }
    try {
      const result = await parseUrl(parsed.data.url);
      const filled = maybeFillCalculated(result);
      const calculatedApplied =
        !!result.beginDate &&
        !!result.endDate &&
        (!result.montageStart || !result.dismantleStart);
      return res.json({
        preview: filled,
        confidence: result.confidence,
        calculatedApplied,
      });
    } catch (err) {
      return bitrixError(res, err);
    }
  });

  app.post("/api/smart-add/confirm", async (req: Request, res: Response) => {
    const parsed = confirmBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "bad-request", message: parsed.error.message });
    }
    if (!hasWebhook()) {
      return res.status(503).json({
        error: "webhook-required",
        message: "BITRIX_WEBHOOK_URL is not configured. See README.",
      });
    }
    try {
      const result = await parseUrl(parsed.data.url);
      const filled = parsed.data.fillCalculated ? maybeFillCalculated(result) : result;
      const title = parsed.data.title ?? filled.title ?? new URL(parsed.data.url).hostname;
      const verified = filled.confidence >= 1.0;
      const usedCalc =
        Boolean(parsed.data.fillCalculated) &&
        !!filled.montageStart &&
        !result.montageStart;
      const log = appendParseLog(undefined, buildParseLogLine(filled, "create"));
      const fields = buildCreatePayload({
        title,
        url: parsed.data.url,
        parsed: filled,
        verified,
        calculated: usedCalc,
        parseLog: log,
      });
      const id = await crmCreateExpo(fields);
      await timelineComment(
        id,
        `Карточка создана из ${parsed.data.url}. Парсер: ${filled.parser}, confidence=${filled.confidence.toFixed(2)}.`,
      );
      return res.json({ id, parsed: filled, verified, calculated: usedCalc });
    } catch (err) {
      return bitrixError(res, err);
    }
  });

  app.post("/api/manual-add", async (req: Request, res: Response) => {
    const parsed = manualBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "bad-request", message: parsed.error.message });
    }
    if (!hasWebhook()) {
      return res.status(503).json({
        error: "webhook-required",
        message: "BITRIX_WEBHOOK_URL is not configured. See README.",
      });
    }
    try {
      const fields: Record<string, any> = { title: parsed.data.title };
      if (parsed.data.beginDate) fields[EXPO_DATE_FIELDS.eventStart] = parsed.data.beginDate;
      if (parsed.data.endDate) fields[EXPO_DATE_FIELDS.eventEnd] = parsed.data.endDate;
      if (parsed.data.url) fields[SMART_FIELDS.sourceUrl] = parsed.data.url;
      fields[SMART_FIELDS.verified] = "N";
      fields[SMART_FIELDS.calculated] = "N";
      const id = await crmCreateExpo(fields);
      const needsRecheck = Boolean(parsed.data.url);
      if (needsRecheck) {
        await timelineComment(
          id,
          `Карточка создана вручную. URL: ${parsed.data.url}. Запланирована автопроверка.`,
        );
      }
      return res.json({ id, needsRecheck });
    } catch (err) {
      return bitrixError(res, err);
    }
  });

  app.post("/api/recheck/:itemId", async (req: Request, res: Response) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      return res.status(400).json({ error: "bad-request", message: "itemId must be a positive number" });
    }
    if (!hasWebhook()) {
      return res.status(503).json({
        error: "webhook-required",
        message: "BITRIX_WEBHOOK_URL is not configured. See README.",
      });
    }
    try {
      const result = await recheckOne(itemId);
      return res.json(result);
    } catch (err) {
      return bitrixError(res, err);
    }
  });

  app.post("/api/recheck-all", async (_req: Request, res: Response) => {
    if (!hasWebhook()) {
      return res.status(503).json({
        error: "webhook-required",
        message: "BITRIX_WEBHOOK_URL is not configured. See README.",
      });
    }
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      const items = await bxListAll<any>(
        "crm.item.list",
        {
          entityTypeId: EXPO_ENTITY_TYPE_ID,
          select: ["id", SMART_FIELDS.sourceUrl, EXPO_DATE_FIELDS.eventEnd],
          filter: { [`>${EXPO_DATE_FIELDS.eventEnd}`]: todayIso },
        },
      );
      const targets = items.filter((it) => {
        const url = pickField(it, SMART_FIELDS.sourceUrl, "UF_CRM_8_SOURCE_URL");
        return typeof url === "string" && url.length > 0;
      });
      const limit = Math.min(targets.length, 25);
      const out: any[] = [];
      for (let i = 0; i < limit; i++) {
        const id = Number(targets[i].id ?? targets[i].ID);
        try {
          out.push(await recheckOne(id));
        } catch (err) {
          out.push({ id, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return res.json({
        scanned: items.length,
        candidates: targets.length,
        processed: out.length,
        results: out,
        truncated: targets.length > limit,
      });
    } catch (err) {
      return bitrixError(res, err);
    }
  });

  return httpServer;
}

async function recheckOne(itemId: number) {
  const item = await crmGetExpo(itemId);
  if (!item) return { id: itemId, error: "not-found" };
  const sourceUrl = pickField(item, SMART_FIELDS.sourceUrl, "UF_CRM_8_SOURCE_URL");
  if (typeof sourceUrl !== "string" || sourceUrl.length === 0) {
    return { id: itemId, error: "no-source-url" };
  }
  const parsed = await parseUrl(sourceUrl);
  const { fields, changes } = computeEnrichmentDiff(item, parsed);
  fields[SMART_FIELDS.lastChecked] = new Date().toISOString();
  if (parsed.confidence >= 1.0 && changes.length > 0) {
    fields[SMART_FIELDS.verified] = "Y";
  }
  const existingLog = pickField(item, SMART_FIELDS.parseLog, "UF_CRM_8_PARSE_LOG");
  fields[SMART_FIELDS.parseLog] = appendParseLog(existingLog, buildParseLogLine(parsed, "recheck"));
  await crmUpdateExpo(itemId, fields);
  for (const change of changes) {
    await timelineComment(itemId, describeChange(change, sourceUrl));
  }
  return { id: itemId, changes, confidence: parsed.confidence, parser: parsed.parser };
}
