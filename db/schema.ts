import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
});
export const incidents = sqliteTable("incidents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  location: text("location").notNull(),
  lat: real("lat"),
  lng: real("lng"),
  description: text("description").notNull(),
  status: text("status").notNull().default("reported"),
  people: integer("people").notNull().default(0),
  teamId: text("team_id"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  version: integer("version").notNull().default(1),
});
export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  specialty: text("specialty").notNull(),
  personnel: integer("personnel").notNull(),
  location: text("location").notNull(),
});
export const resources = sqliteTable("resources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  quantity: integer("quantity").notNull(),
  location: text("location").notNull(),
  version: integer("version").notNull().default(1),
});
export const requests = sqliteTable("requests", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id")
    .notNull()
    .references(() => incidents.id),
  resourceId: text("resource_id")
    .notNull()
    .references(() => resources.id),
  quantity: integer("quantity").notNull(),
  status: text("status").notNull().default("pending"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  version: integer("version").notNull().default(1),
});
export const activity = sqliteTable("activity", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull(),
});
export const receipts = sqliteTable("receipts", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  bodyHash: text("body_hash").notNull(),
  resultId: text("result_id").notNull(),
  createdAt: text("created_at").notNull(),
});
