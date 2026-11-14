import { z } from "zod";
const short = z.string().trim().min(2).max(120);
const id = z.string().uuid();
const count = z.number().int().min(0).max(1000000);
export const incidentInput = z
  .object({
    title: short,
    type: z.enum([
      "Flood",
      "Earthquake",
      "Fire",
      "Cyclone",
      "Landslide",
      "Other",
    ]),
    severity: z.enum(["critical", "high", "medium", "low"]),
    location: short,
    description: z.string().trim().min(10).max(2000),
    people: count,
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
  })
  .refine(
    (v) => (v.lat === null) === (v.lng === null),
    "Provide both coordinates or neither",
  );
export const actionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("incident"), data: incidentInput }),
  z.object({
    action: z.literal("status"),
    id,
    version: z.number().int().positive(),
    status: z.enum(["reported", "responding", "contained", "resolved"]),
    teamId: id.nullable(),
    automatic: z.boolean().optional().default(false),
  }),
  z.object({
    action: z.literal("team"),
    lat: z.number().min(-90).max(90).nullable().optional().default(null),
    lng: z.number().min(-180).max(180).nullable().optional().default(null),
    available: z.boolean().optional().default(true),
    name: short,
    specialty: short,
    personnel: count.min(1),
    location: short,
  }),
  z.object({
    action: z.literal("team_position"),
    id,
    version: z.number().int().positive(),
    location: short,
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    available: z.boolean(),
  }),
  z.object({
    action: z.literal("incident_position"),
    id,
    version: z.number().int().positive(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  z.object({
    action: z.literal("resource"),
    name: short,
    unit: short,
    quantity: count,
    location: short,
  }),
  z.object({
    action: z.literal("restock"),
    id,
    version: z.number().int().positive(),
    quantity: count.min(1),
  }),
  z.object({
    action: z.literal("request"),
    incidentId: id,
    resourceId: id,
    quantity: count.min(1),
  }),
  z.object({
    action: z.literal("fulfill"),
    id,
    version: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("cancel"),
    id,
    version: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("role"),
    id: z.string().min(1).max(200),
    role: z.enum(["coordinator", "responder", "reporter"]),
  }),
]);
export const transitions: Record<string, string[]> = {
  reported: ["responding", "resolved"],
  responding: ["contained", "resolved"],
  contained: ["responding", "resolved"],
  resolved: [],
};
