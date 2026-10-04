import { type ColumnType, type Generated, type Kysely, sql } from "kysely";
import type { EventMetadata } from "../eventStore/Event";

export interface EventTable {
  position: Generated<string>;
  transaction_id: Generated<string>;
  id: string;
  aggregate_id: string;
  aggregate_type: string;
  version: number;
  event_type: string;
  created_at: Date;
  metadata: ColumnType<EventMetadata, string, never>;
  data: ColumnType<object, string, never>;
}

export interface ProjectionStateTable {
  name: string;
  position: ColumnType<string, number | undefined, number>;
  updated_at: ColumnType<Date | null, Date | undefined, Date>;
  failed_position: ColumnType<string | null, number | undefined, number | null>;
  last_error: ColumnType<string | null, string | undefined, string | null>;
  last_error_at: ColumnType<Date | null, Date | undefined, Date | null>;
}

export const eventVersionConstraint = "event_aggregate_version_unique";

export type EventDatabase = {
  event: EventTable;
  projection_state: ProjectionStateTable;
};

export async function createEventTable(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("event")
    .addColumn("position", "bigserial", (col) => col.notNull().unique())
    .addColumn("transaction_id", sql`xid8`, (col) => col.notNull().defaultTo(sql`pg_current_xact_id()`))
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

export async function createProjectionStateTable(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("projection_state")
    .addColumn("name", "text", (col) => col.primaryKey())
    .addColumn("position", "bigint", (col) => col.notNull().defaultTo(0))
    .addColumn("updated_at", "timestamptz")
    .addColumn("failed_position", "bigint")
    .addColumn("last_error", "text")
    .addColumn("last_error_at", "timestamptz")
    .execute();
}

export async function dropProjectionStateTable(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("projection_state").execute();
}
