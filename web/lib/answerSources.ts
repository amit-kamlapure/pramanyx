/**
 * What an answer stood on, as the app's own pages to open beside the conversation: the metric's definition, the Definition a
 * person wrote, the spreadsheet it read, the ontology's object. Each page shows only that one thing.
 */
import type { ReceiptSources } from "@/lib/api";

export type SourceKind = "metric" | "definition" | "sheet" | "object";

export interface AnswerSource {
  key: string;
  kind: SourceKind;
  label: string;
  /** What the mark says when a person rests on it. */
  title: string;
  /** The app's own page for it. */
  page: string;
}

export const OBJECTS_SHOWN = 4;
const SHEETS_CONNECTION = "sheets";
const bareTable = (name: string) => (name.split(".").pop() ?? name).toLowerCase();
const on = (connection: string) => `?conn=${encodeURIComponent(connection)}`;

export function answerSources(read: ReceiptSources, connection: string, sheets: ReadonlyMap<string, { id: string; name: string }> = new Map()): AnswerSource[] {
  const overSheets = connection === SHEETS_CONNECTION;
  const out: AnswerSource[] = [
    ...read.metrics.map((m): AnswerSource => ({
      key: `metric:${m.name}`, kind: "metric", label: m.departed ? `${m.name} · not used as approved` : m.name,
      title: m.departed ? "The answer did not use this metric as approved. Opens its definition." : "The approved metric this answer was held to. Opens its definition.",
      page: `/metrics/${encodeURIComponent(m.name)}${on(connection)}`,
    })),
    ...read.definitions.map((term): AnswerSource => ({
      key: `definition:${term}`, kind: "definition", label: term, title: "A Definition this answer was given. Opens it.",
      page: `/definitions/${encodeURIComponent(term)}${on(connection)}`,
    })),
  ];
  for (const name of read.objects) {
    const sheet = overSheets ? sheets.get(bareTable(name)) : undefined;
    out.push(sheet
      ? { key: `sheet:${sheet.id}`, kind: "sheet", label: sheet.name, title: "A spreadsheet this answer read. Opens it.",
          page: `/sheets/${encodeURIComponent(sheet.id)}?name=${encodeURIComponent(sheet.name)}` }
      : { key: `object:${name}`, kind: "object", label: name, title: "What this answer read. Opens it in the ontology.",
          page: `/ontology/${encodeURIComponent(name)}${on(connection)}` });
  }
  return out;
}
