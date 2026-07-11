// Shared Claude Vision classifier for garden photos. Consumed by the batch
// import script (Phase 1) and the live upload path (Phase 2).

export const MODEL = "claude-sonnet-4-6";
export const AREAS = ["front", "pool", "south"];

/** Strict system prompt anchored on permanent hardscape, grouped by area. */
export function buildSystemPrompt(zones) {
  const byArea = { front: [], pool: [], south: [] };
  for (const z of zones) {
    if (byArea[z.area]) byArea[z.area].push(z);
  }
  const zoneLines = AREAS.map((area) => {
    const items = byArea[area]
      .map((z) => `    - ${z.slug} — ${z.name}: ${z.description ?? ""}`.trimEnd())
      .join("\n");
    return `  ${area.toUpperCase()}:\n${items || "    (none)"}`;
  }).join("\n");

  return `You classify historical photographs of a single residential yard in Richardson, TX (a corner lot). Your job is to decide WHICH part of THIS yard each photo shows, using only the PERMANENT architecture — never the plants or temporary features, which change constantly across the 1.5 years of photos.

PERMANENT ANCHORS (these never move — judge location by these alone):
- A one-story BRICK house with consistent siding, windows, and a covered porch on the west side.
- An A/C pad and small shed on the NORTH side of the house.
- A concrete patio between the house and the pool.
- A kidney-shaped POOL and an octagonal SPA on the east side.
- A concrete DRIVEWAY on the southeast, leading to an alley.
- A wood FENCE (southeast) and the property boundary.
- A frontage parkway / sidewalk along the street (southwest).
- A giant RED OAK tree. The Red Oak is the firm FRONT ↔ SOUTH divider: anything past (south of) the Red Oak is the SOUTH area.

AREAS and their ZONES (return one of these zone slugs when you can identify the exact bed; otherwise return just the area):
${zoneLines}

RULES:
- IGNORE transient foreground entirely when deciding location: plants, flowers, mulch, tools, furniture, and hardscaping that was ADDED over time (the stock tank fountain, raised beds, vines, cover-crop field, cedar planters). These are the CHANGES we are dating — not anchors. A bed that does not physically exist yet in a photo cannot be the answer.
- Choose the most specific zone slug you are confident about. If you can identify the area but not the exact bed, set zone_slug to null and still return the area.
- If the photo is NOT of this yard (screenshot, receipt, indoor shot, unrelated), set is_yard=false.
- confidence is your confidence in the zone_slug (0–1). If zone_slug is null, it is your confidence in the area.

ENRICHMENT (fill even when location is uncertain):
- caption: one plain sentence describing the photo.
- tags: short freeform keywords.
- plants: EVERY plant you can identify by name. Do not limit the count; list them all.
- hardscape: which of these permanent-ish additions are visibly present.
- botanical: bloom_colors seen, plus any notes.

Respond ONLY with the required JSON object.`;
}

/** JSON schema for structured outputs. zone_slug/area constrained to known values or null. */
export function buildClassificationSchema(zoneSlugs) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      is_yard: { type: "boolean" },
      quality: { type: "string", enum: ["good", "ok", "poor"] },
      area: { anyOf: [{ type: "string", enum: AREAS }, { type: "null" }] },
      zone_slug: { anyOf: [{ type: "string", enum: zoneSlugs }, { type: "null" }] },
      confidence: { type: "number" },
      reasoning: { type: "string" },
      caption: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      plants: { type: "array", items: { type: "string" } },
      hardscape: {
        type: "object",
        additionalProperties: false,
        properties: {
          stock_tank: { type: "boolean" },
          raised_beds: { type: "boolean" },
          vines: { type: "boolean" },
          cover_crop_field: { type: "boolean" },
          cedar_planters: { type: "boolean" },
        },
        required: ["stock_tank", "raised_beds", "vines", "cover_crop_field", "cedar_planters"],
      },
      botanical: {
        type: "object",
        additionalProperties: false,
        properties: {
          bloom_colors: { type: "array", items: { type: "string" } },
          notes: { type: "string" },
        },
        required: ["bloom_colors", "notes"],
      },
    },
    required: [
      "is_yard", "quality", "area", "zone_slug", "confidence", "reasoning",
      "caption", "tags", "plants", "hardscape", "botanical",
    ],
  };
}

const userContent = (base64Image, mediaType) => [
  { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
  { type: "text", text: "Classify this photo of the yard." },
];

/** One entry for the Batches API `requests` array. */
export function buildBatchRequest({ customId, systemPrompt, schema, base64Image, mediaType }) {
  return {
    custom_id: customId,
    params: {
      model: MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent(base64Image, mediaType) }],
      output_config: { format: { type: "json_schema", schema } },
    },
  };
}

/** Normalize the model's JSON text into a stable shape with defaults. */
export function parseClassification(text) {
  const raw = typeof text === "string" ? JSON.parse(text) : text;
  return {
    is_yard: raw.is_yard === true,
    quality: raw.quality ?? "ok",
    area: raw.area ?? null,
    zone_slug: raw.zone_slug ?? null,
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
    reasoning: raw.reasoning ?? "",
    caption: raw.caption ?? "",
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    plants: Array.isArray(raw.plants) ? raw.plants : [],
    hardscape: raw.hardscape && typeof raw.hardscape === "object" ? raw.hardscape : {},
    botanical: raw.botanical && typeof raw.botanical === "object" ? raw.botanical : {},
  };
}

/** Real-time single classification (Phase 2 live path). */
export async function classifyImage(client, { systemPrompt, schema, base64Image, mediaType }) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent(base64Image, mediaType) }],
    output_config: { format: { type: "json_schema", schema } },
  });
  const textBlock = msg.content.find((b) => b.type === "text");
  return parseClassification(textBlock ? textBlock.text : "{}");
}
