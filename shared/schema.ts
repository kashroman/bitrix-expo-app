import { z } from "zod";

export const appConfigSchema = z.object({
  portalUrl: z.string().url(),
  company: z.string(),
  appName: z.string(),
  placements: z.object({
    dealTab: z.string(),
    dynamicTabTemplate: z.string(),
    calendar: z.string(),
  }),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export const detectedFieldSchema = z.object({
  code: z.string(),
  title: z.string(),
  type: z.string().optional(),
  confidence: z.enum(["high", "medium", "low"]),
});

export type DetectedField = z.infer<typeof detectedFieldSchema>;
