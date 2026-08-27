import { NextResponse } from "next/server";

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const DATABASE_ID = process.env.NOTION_TASKS_DATABASE_ID?.trim() || "1264208d-f768-4604-b4cb-09f4d6fd41e3";
const noStore = { "Cache-Control": "no-store" };

const unavailable = () => NextResponse.json(
  { status: "unavailable", source: "not-configured", updatedAt: null, tasks: [] },
  { headers: noStore },
);
const writeUnavailable = () => NextResponse.json(
  { error: "Notion tasks are not configured", status: "unavailable", source: "not-configured", updatedAt: null },
  { status: 503, headers: noStore },
);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textAt(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) current = asRecord(current)?.[key];
  return typeof current === "string" ? current : null;
}

function notionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };
}

export async function GET() {
  if (!NOTION_API_KEY) return unavailable();
  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: "POST",
      headers: notionHeaders(),
      body: JSON.stringify({ filter: { property: "Status", status: { does_not_equal: "Done" } } }),
    });
    if (!response.ok) throw new Error(`Notion query failed (${response.status})`);
    const payload: unknown = await response.json();
    const results = asRecord(payload)?.results;
    if (!Array.isArray(results)) throw new Error("Notion returned an invalid task response");
    const tasks = results.map((page) => {
      const record = asRecord(page);
      const properties = asRecord(record?.properties);
      const title = asRecord(properties?.Name)?.title;
      const firstTitle = Array.isArray(title) ? title[0] : null;
      return {
        id: typeof record?.id === "string" ? record.id : "",
        name: textAt(firstTitle, ["plain_text"]) ?? "Untitled",
        status: textAt(properties?.Status, ["status", "name"]) ?? "Not started",
        priority: textAt(properties?.Priority, ["select", "name"]) ?? "",
        category: textAt(properties?.Category, ["select", "name"]) ?? "",
        dueDate: textAt(properties?.["Due Date"], ["date", "start"]),
      };
    }).filter((task) => task.id);
    const updatedAt = results.reduce<string | null>((latest, page) => {
      const timestamp = asRecord(page)?.last_edited_time;
      return typeof timestamp === "string" && (!latest || timestamp > latest) ? timestamp : latest;
    }, null);
    return NextResponse.json({
      status: updatedAt ? "available" : "unavailable",
      source: "notion",
      updatedAt,
      tasks: updatedAt ? tasks : [],
    }, { headers: noStore });
  } catch (error) {
    console.error("Tasks API error:", error);
    return NextResponse.json({ error: "Failed to fetch Notion tasks", status: "unavailable", source: "notion", updatedAt: null, tasks: [] }, { status: 503, headers: noStore });
  }
}

export async function POST(request: Request) {
  if (!NOTION_API_KEY) return writeUnavailable();
  try {
    const body = asRecord(await request.json());
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const status = typeof body?.status === "string" ? body.status : "Not started";
    if (!name) return NextResponse.json({ error: "Task name is required" }, { status: 400, headers: noStore });
    const response = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: notionHeaders(),
      body: JSON.stringify({ parent: { database_id: DATABASE_ID }, properties: { Name: { title: [{ text: { content: name } }] }, Status: { status: { name: status } } } }),
    });
    if (!response.ok) throw new Error(`Notion create failed (${response.status})`);
    return NextResponse.json({ success: true, task: await response.json(), source: "notion" }, { headers: noStore });
  } catch (error) {
    console.error("Create task error:", error);
    return NextResponse.json({ error: "Failed to create Notion task" }, { status: 503, headers: noStore });
  }
}

export async function PATCH(request: Request) {
  if (!NOTION_API_KEY) return writeUnavailable();
  try {
    const body = asRecord(await request.json());
    const id = typeof body?.id === "string" ? body.id : "";
    const status = typeof body?.status === "string" ? body.status : "";
    if (!id || !status) return NextResponse.json({ error: "Task id and status are required" }, { status: 400, headers: noStore });
    const response = await fetch(`https://api.notion.com/v1/pages/${id}`, {
      method: "PATCH",
      headers: notionHeaders(),
      body: JSON.stringify({ properties: { Status: { status: { name: status } } } }),
    });
    if (!response.ok) throw new Error(`Notion update failed (${response.status})`);
    return NextResponse.json({ success: true, task: await response.json(), source: "notion" }, { headers: noStore });
  } catch (error) {
    console.error("Update task error:", error);
    return NextResponse.json({ error: "Failed to update Notion task" }, { status: 503, headers: noStore });
  }
}
