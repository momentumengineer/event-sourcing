import { type ColumnType, type Generated, type Kysely, sql } from "kysely";
import type { EventMetadata } from "../eventStore/Event";

export interface EventTable {
  position: Generated<string>;
  id: string;
  aggregate_id: string;
  aggregate_type: string;
  version: number;
  event_type: string;
  created_at: Date;
  metadata: ColumnType<EventMetadata, string, never>;
  data: ColumnType<object, string, never>;
}

export const eventVersionConstraint = "event_aggregate_version_unique";

export type EventDatabase = {
  event: EventTable;
};

export async function createEventTable(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("event")
    .addColumn("position", "bigserial", (col) => col.notNull().unique())
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("aggregate_id", "text", (col) => col.notNull())
    .addColumn("aggregate_type", "text", (col) => col.notNull())
    .addColumn("version", "integer", (col) => col.notNull())
    .addColumn("event_type", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("metadata", "jsonb", (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("data", "jsonb", (col) => col.notNull())
    .addUniqueConstraint(eventVersionConstraint, [
      "aggregate_type",
      "aggregate_id",
      "version",
    ])
    .execute();

  await db.schema
    .createIndex("event_aggregate_type_index")
    .on("event")
    .columns(["aggregate_type", "position"])
    .execute();
}

export async function dropEventTable(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("event").execute();
}
