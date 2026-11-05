// Vercel serverless function: lets the Systems Map talk to your Notion General Calendar
// and Customers database. Needs the NOTION_TOKEN environment variable in Vercel.
// The browser sends the same tool names the Claude version used; this file translates
// them to the official Notion API.

const NOTION_VERSION = "2025-09-03";
const API = "https://api.notion.com/v1";

function toId(s) {
  const str = String(s || "");
  const uuid = str.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return uuid[0];
  const hex = str.match(/[0-9a-f]{32}/i);
  return hex ? hex[0] : null;
}

async function notion(path, method = "GET", body) {
  const r = await fetch(API + path, {
    method,
    headers: {
      Authorization: "Bearer " + process.env.NOTION_TOKEN,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.message || "Notion error " + r.status);
    e.code = r.status === 401 ? "needs_reauth" : "tool_error";
    throw e;
  }
  return j;
}

// Turn the simple property map the page sends into Notion API format,
// using the real property types from the schema.
function buildProps(input, schema) {
  const out = {};
  const dateStart = input["date:Date:start"];
  for (const [key, val] of Object.entries(input)) {
    if (key.startsWith("date:")) continue;
    const def = schema[key];
    if (!def) continue;
    const t = def.type;
    if (t === "title") out[key] = { title: [{ text: { content: String(val || "") } }] };
    else if (t === "rich_text") out[key] = { rich_text: [{ text: { content: String(val || "") } }] };
    else if (t === "status") out[key] = val ? { status: { name: String(Array.isArray(val) ? val[0] : val) } } : { status: null };
    else if (t === "select") out[key] = val ? { select: { name: String(Array.isArray(val) ? val[0] : val) } } : { select: null };
    else if (t === "multi_select") out[key] = { multi_select: (Array.isArray(val) ? val : [val]).filter(Boolean).map(name => ({ name: String(name) })) };
    else if (t === "relation") out[key] = { relation: (Array.isArray(val) ? val : [val]).map(toId).filter(Boolean).map(id => ({ id })) };
  }
  if ("date:Date:start" in input && schema.Date) {
    out.Date = { date: dateStart ? { start: String(dateStart).slice(0, 10) } : null };
  }
  return out;
}

// Minimal markdown → Notion blocks (headings, to-dos, bullets, paragraphs, **bold**, [links](url))
function rich(text) {
  const parts = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ text: { content: text.slice(last, m.index) } });
    if (m[1]) parts.push({ text: { content: m[1] }, annotations: { bold: true } });
    else parts.push({ text: { content: m[2], link: /^https?:/.test(m[3]) ? { url: m[3] } : null } });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ text: { content: text.slice(last) } });
  return parts.length ? parts : [{ text: { content: "" } }];
}
function mdToBlocks(md) {
  const blocks = [];
  for (const line of String(md || "").split("\n")) {
    if (!line.trim()) continue;
    let m;
    if ((m = line.match(/^##\s+(.*)/))) blocks.push({ heading_2: { rich_text: rich(m[1]) } });
    else if ((m = line.match(/^-\s+\[( |x)\]\s+(.*)/i))) blocks.push({ to_do: { rich_text: rich(m[2]), checked: m[1].toLowerCase() === "x" } });
    else if ((m = line.match(/^-\s+(.*)/))) blocks.push({ bulleted_list_item: { rich_text: rich(m[1]) } });
    else blocks.push({ paragraph: { rich_text: rich(line) } });
  }
  return blocks.slice(0, 100);
}

function plain(prop) {
  if (!prop) return "";
  switch (prop.type) {
    case "title": return prop.title.map(t => t.plain_text).join("");
    case "rich_text": return prop.rich_text.map(t => t.plain_text).join("");
    case "select": return prop.select ? prop.select.name : "";
    case "status": return prop.status ? prop.status.name : "";
    case "multi_select": return prop.multi_select.map(o => o.name).join(", ");
    case "date": return prop.date ? prop.date.start : "";
    default: return "";
  }
}

const tools = {
  async ping() { return { ok: !!process.env.NOTION_TOKEN }; },

  async "notion-create-pages"(input) {
    const dsId = toId(input.parent && input.parent.data_source_id);
    const ds = await notion("/data_sources/" + dsId);
    const page = input.pages[0];
    const created = await notion("/pages", "POST", {
      parent: { type: "data_source_id", data_source_id: dsId },
      properties: buildProps(page.properties || {}, ds.properties || {}),
      children: mdToBlocks(page.content),
    });
    return { id: created.id, url: created.url };
  },

  async "notion-update-page"(input) {
    const id = toId(input.page_id);
    const current = await notion("/pages/" + id);
    const updated = await notion("/pages/" + id, "PATCH", { properties: buildProps(input.properties || {}, current.properties || {}) });
    return { id: updated.id, url: updated.url };
  },

  async "notion-fetch"(input) {
    const page = await notion("/pages/" + toId(input.id));
    const props = {};
    for (const [k, v] of Object.entries(page.properties || {})) {
      if (v.type === "date") props["date:" + k + ":start"] = v.date ? v.date.start : null;
      else props[k] = plain(v);
    }
    return { text: "<properties>" + JSON.stringify(props) + "</properties>" };
  },

  async "notion-query-data-sources"(input) {
    const d = input.data || {};
    const dsId = toId(d.data_source_url);
    const res = await notion("/data_sources/" + dsId + "/query", "POST", { page_size: Math.min(d.limit || 100, 100) });
    return {
      results: res.results.map(p => {
        const row = { url: p.url };
        for (const [k, v] of Object.entries(p.properties || {})) row[k] = plain(v);
        return row;
      }),
    };
  },
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { tool, input } = req.body || {};
  if (tool !== "ping" && !process.env.NOTION_TOKEN) return res.status(200).json({ error: "NOTION_TOKEN not set", code: "not_granted" });
  const fn = tools[tool];
  if (!fn) return res.status(400).json({ error: "Unknown tool" });
  try {
    const out = await fn(input || {});
    if (tool === "ping") return res.status(200).json(out);
    res.status(200).json({ payload: out });
  } catch (e) {
    res.status(200).json({ error: e.message, code: e.code || "tool_error" });
  }
};
