import type { Express } from "express";
import type { Server } from "node:http";
import { appConfigSchema } from "@shared/schema";

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

  return httpServer;
}
