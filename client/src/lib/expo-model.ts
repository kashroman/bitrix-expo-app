import { callBx, CrmField, CrmItem, listAllBx, SmartType } from "./bitrix";

export type DetectedField = {
  code: string;
  title: string;
  type?: string;
  confidence: "high" | "medium" | "low";
};

export type ExpoDetection = {
  expoType?: SmartType;
  dealExpoField?: DetectedField;
  leadExpoField?: DetectedField;
  dateFields: {
    mountStart?: DetectedField;
    eventStart?: DetectedField;
    eventEnd?: DetectedField;
    dismantleEnd?: DetectedField;
  };
  resultFields: DetectedField[];
  allExpoDateFields: DetectedField[];
  candidateExpoFields: DetectedField[];
  editableExpoFields: DetectedField[];
  raw: {
    dealFields?: Record<string, CrmField>;
    leadFields?: Record<string, CrmField>;
    expoFields?: Record<string, CrmField>;
  };
  notes: string[];
};

const ru = (value?: string) => (value ?? "").toLocaleLowerCase("ru-RU");

function fieldEntries(fields?: Record<string, CrmField>) {
  return Object.entries(fields ?? {}).map(([code, field]) => ({
    code,
    title: field.title ?? code,
    type: field.type,
    field,
    haystack: `${ru(code)} ${ru(field.title)}`,
  }));
}

function detectByWords(
  fields: Record<string, CrmField> | undefined,
  requiredGroups: string[][],
  preferredTypes?: string[],
): DetectedField | undefined {
  const candidates = fieldEntries(fields).map((entry) => {
    const wordScore = requiredGroups.reduce((score, group) => {
      return score + (group.some((word) => entry.haystack.includes(word)) ? 1 : 0);
    }, 0);
    const typeScore = preferredTypes?.includes(entry.type ?? "") ? 1 : 0;
    return { ...entry, score: wordScore * 10 + typeScore };
  });
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 10) return undefined;
  return {
    code: best.code,
    title: best.title,
    type: best.type,
    confidence: best.score >= 21 ? "high" : best.score >= 11 ? "medium" : "low",
  };
}

function detectLinkToExpo(
  fields: Record<string, CrmField> | undefined,
  entityTypeId?: number,
): DetectedField | undefined {
  const entries = fieldEntries(fields);
  const exactParent = entries.find((entry) => {
    const parentId = entry.field.settings?.parentEntityTypeId;
    return entityTypeId && Number(parentId) === Number(entityTypeId);
  });
  if (exactParent) {
    return {
      code: exactParent.code,
      title: exactParent.title,
      type: exactParent.type,
      confidence: "high",
    };
  }

  return detectByWords(
    fields,
    [["выстав", "expo", "exhibition"], ["привяз", "связ", "link"]],
    ["crm_entity", "crm_dynamic", "integer"],
  );
}

export async function detectExpoModel(): Promise<ExpoDetection> {
  const notes: string[] = [];
  const typesData = await callBx<{ types: SmartType[] }>("crm.type.list", {
    order: { title: "ASC" },
  });
  const expoType =
    typesData.types.find((type) => ru(type.title).trim() === "выставки") ??
    typesData.types.find((type) => ru(type.title).includes("выстав")) ??
    typesData.types.find((type) => ru(type.code).includes("expo"));

  if (!expoType) {
    notes.push("Смарт-процесс “Выставки” не найден по названию. Укажите entityTypeId вручную.");
  }

  const [dealFields, leadFields, expoFieldsData] = await Promise.all([
    callBx<Record<string, CrmField>>("crm.deal.fields", {}),
    callBx<Record<string, CrmField>>("crm.lead.fields", {}),
    expoType
      ? callBx<{ fields: Record<string, CrmField> }>("crm.item.fields", {
          entityTypeId: expoType.entityTypeId,
          useOriginalUfNames: "N",
        })
      : Promise.resolve({ fields: {} }),
  ]);
  const expoFields = expoFieldsData.fields;

  const dealExpoField = detectLinkToExpo(dealFields, expoType?.entityTypeId);
  const leadExpoField = detectLinkToExpo(leadFields, expoType?.entityTypeId);
  const dateFields = {
    mountStart: detectByWords(
      expoFields,
      [["монтаж", "застрой", "mount"], ["нач", "start", "дата"]],
      ["date", "datetime"],
    ),
    eventStart:
      detectByWords(expoFields, [["проведен", "период", "выстав", "event"], ["нач", "start"]], [
        "date",
        "datetime",
      ]) ?? detectByWords(expoFields, [["дата начала", "begindate"]], ["date", "datetime"]),
    eventEnd:
      detectByWords(expoFields, [["проведен", "период", "выстав", "event"], ["оконч", "end"]], [
        "date",
        "datetime",
      ]) ?? detectByWords(expoFields, [["дата завершения", "closedate"]], ["date", "datetime"]),
    dismantleEnd: detectByWords(
      expoFields,
      [["демонтаж", "dismant"], ["оконч", "end", "дата"]],
      ["date", "datetime"],
    ),
  };

  const resultFields = fieldEntries(expoFields)
    .filter((entry) =>
      ["итог", "результ", "result", "выруч", "сумм", "лид", "сдел"].some((word) =>
        entry.haystack.includes(word),
      ),
    )
    .filter((entry) => !entry.field.isReadOnly && !entry.field.isImmutable)
    .slice(0, 10)
    .map((entry) => {
      const confidence: DetectedField["confidence"] =
        entry.haystack.includes("итог") || entry.haystack.includes("результ") ? "high" : "medium";
      return {
        code: entry.code,
        title: entry.title,
        type: entry.type,
        confidence,
      };
    });

  const editableExpoFields = fieldEntries(expoFields)
    .filter((entry) => !entry.field.isReadOnly && !entry.field.isImmutable)
    .filter((entry) => ["string", "text", "date", "datetime", "double", "integer", "boolean"].includes(entry.type ?? ""))
    .slice(0, 16)
    .map((entry) => ({
      code: entry.code,
      title: entry.title,
      type: entry.type,
      confidence: "medium" as const,
    }));

  const allExpoDateFields = fieldEntries(expoFields)
    .filter((entry) => ["date", "datetime"].includes(entry.type ?? ""))
    .map((entry) => ({
      code: entry.code,
      title: entry.title,
      type: entry.type,
      confidence: "high" as const,
    }));

  const candidateExpoFields = fieldEntries(expoFields)
    .filter((entry) =>
      [
        "монтаж",
        "демонтаж",
        "выстав",
        "проведен",
        "начал",
        "оконч",
        "итог",
        "результ",
        "сделк",
        "лид",
        "сумм",
      ].some((word) => entry.haystack.includes(word)),
    )
    .map((entry) => ({
      code: entry.code,
      title: entry.title,
      type: entry.type,
      confidence: "medium" as const,
    }));

  if (!dealExpoField) notes.push("Поле привязки выставки в сделке не найдено автоматически.");
  if (!leadExpoField) notes.push("Поле привязки выставки в лиде не найдено автоматически.");
  if (!dateFields.eventStart || !dateFields.eventEnd) {
    notes.push("Поля дат проведения выставки определены не полностью.");
  }

  return {
    expoType,
    dealExpoField,
    leadExpoField,
    dateFields,
    resultFields,
    allExpoDateFields,
    candidateExpoFields,
    editableExpoFields,
    raw: { dealFields, leadFields, expoFields },
    notes,
  };
}

export async function getItem(entityTypeId: number, id: string | number) {
  const data = await callBx<{ item: CrmItem }>("crm.item.get", {
    entityTypeId,
    id,
    useOriginalUfNames: "N",
  });
  return data.item;
}

export async function getDeal(id: string | number) {
  const data = await callBx<CrmItem>("crm.deal.get", { id });
  return data;
}

export async function listExpoItems(entityTypeId: number): Promise<CrmItem[]> {
  return listAllBx<CrmItem>("crm.item.list", {
    entityTypeId,
    select: ["*", "ufCrm*"],
    order: { id: "DESC" },
  });
}

export async function listDealsByExpo(fieldCode: string, expoId: string | number): Promise<CrmItem[]> {
  return listAllBx<CrmItem>("crm.deal.list", {
    filter: { [fieldCode]: expoId },
    select: ["ID", "TITLE", "STAGE_ID", "OPPORTUNITY", "CURRENCY_ID", "COMPANY_ID", fieldCode],
    order: { ID: "DESC" },
  });
}

export async function listLeadsByExpo(fieldCode: string, expoId: string | number): Promise<CrmItem[]> {
  return listAllBx<CrmItem>("crm.lead.list", {
    filter: { [fieldCode]: expoId },
    select: ["ID", "TITLE", "STATUS_ID", "OPPORTUNITY", "CURRENCY_ID", "COMPANY_ID", fieldCode],
    order: { ID: "DESC" },
  });
}

export async function updateCrmItem(entityTypeId: number, id: string | number, fields: Record<string, unknown>) {
  return callBx("crm.item.update", {
    entityTypeId,
    id,
    fields,
  });
}

export async function updateDeal(id: string | number, fields: Record<string, unknown>) {
  return callBx("crm.deal.update", { id, fields });
}
