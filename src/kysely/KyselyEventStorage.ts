import { type Kysely, type Selectable, sql, type Transaction } from "kysely";
import type { EventMetadata } from "../eventStore/Event";
import {
  type AppendOptions,
  ConcurrencyError,
  type EventRecord,
  type EventStorage,
  type ProjectionState,
  type ProjectionStateStorage,
  type StoredEvent,
} from "../eventStore/EventStorage";
import {
  type EventDatabase,
  type EventTable,
  eventVersionConstraint,
  type ProjectionStateTable,
} from "./EventTable";
import { decode, encode } from "./json";

export class KyselyEventStorage<DB = unknown>
  implements EventStorage<Transaction<DB>>, ProjectionStateStorage<Transaction<DB>>
{
  private readonly events: Kysely<EventDatabase>;

  constructor(private readonly db: Kysely<DB>) {
    this.events = db as unknown as Kysely<EventDatabase>;
  }

  async append(events: EventRecord[], options: AppendOptions): Promise<void> {
    if (events.length === 0) return;
    const { aggregateType, aggregateId, expectedVersion } = options;

    const write = async (trx: Kysely<EventDatabase>) => {
      const { version } = await trx
        .selectFrom("event")
        .select((eb) => eb.fn.max("version").as("version"))
        .where("aggregate_type", "=", aggregateType)
        .where("aggregate_id", "=", aggregateId)
        .executeTakeFirstOrThrow();
      const currentVersion = Number(version ?? 0);

      if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
        throw new ConcurrencyError(aggregateType, aggregateId, expectedVersion);
      }

      await trx
        .insertInto("event")
        .values(
          events.map((event, index) => ({
            id: event.id,
            aggregate_id: aggregateId,
            aggregate_type: aggregateType,
            version: currentVersion + index + 1,
            event_type: event.type,
            created_at: event.createdAt,
            metadata: JSON.stringify(encode(event.metadata)),
            data: JSON.stringify(encode(event.data)),
          })),
        )
        .execute();
    };

    try {
      if (this.events.isTransaction) await write(this.events);
      else await this.events.transaction().execute(write);
    } catch (error) {
      if (isConflict(error)) {
        throw new ConcurrencyError(aggregateType, aggregateId, expectedVersion);
      }
      throw error;
    }
  }

  async load(aggregateType: string, aggregateId?: string): Promise<StoredEvent[]> {
    let query = this.events
      .selectFrom("event")
      .selectAll()
      .where("aggregate_type", "=", aggregateType);
    query =
      aggregateId === undefined
        ? query.orderBy("position")
        : query.where("aggregate_id", "=", aggregateId).orderBy("version");

    const rows = await query.execute();
    return rows.map(toStoredEvent);
  }

  async loadAfter(position: number, limit: number, aggregateTypes?: string[]): Promise<StoredEvent[]> {
    if (aggregateTypes?.length === 0) return [];

    let query = this.events
      .selectFrom("event")
      .selectAll()
      .where("position", ">", String(position))
      .where(sql<boolean>`transaction_id < pg_snapshot_xmin(pg_current_snapshot())`);
    if (aggregateTypes) query = query.where("aggregate_type", "in", aggregateTypes);

    const rows = await query.orderBy("position").limit(limit).execute();
    return rows.map(toStoredEvent);
  }

  transaction<T>(fn: (tx: Transaction<DB>) => Promise<T>): Promise<T> {
    if (this.db.isTransaction) return fn(this.db as Transaction<DB>);
    return this.db.transaction().execute(fn);
  }

  async getProjectionState(name: string): Promise<ProjectionState> {
    const row = await this.events
      .selectFrom("projection_state")
      .selectAll()
      .where("name", "=", name)
      .executeTakeFirst();
    return row ? toProjectionState(row) : emptyProjectionState(name);
  }

  async lockProjection(tx: Transaction<DB>, name: string): Promise<number> {
    const trx = tx as unknown as Kysely<EventDatabase>;
    await trx
      .insertInto("projection_state")
      .values({ name })
      .onConflict((oc) => oc.column("name").doNothing())
      .execute();
    const row = await trx
      .selectFrom("projection_state")
      .select("position")
      .where("name", "=", name)
      .forUpdate()
      .executeTakeFirstOrThrow();
    return Number(row.position);
  }

  async saveProjectionPosition(tx: Transaction<DB>, name: string, position: number): Promise<void> {
    await (tx as unknown as Kysely<EventDatabase>)
      .updateTable("projection_state")
      .set({
        position,
        updated_at: new Date(),
        failed_position: null,
        last_error: null,
        last_error_at: null,
      })
      .where("name", "=", name)
      .execute();
  }

  async saveProjectionError(name: string, position: number, error: string): Promise<void> {
    const values = { failed_position: position, last_error: error, last_error_at: new Date() };
    await this.events
      .insertInto("projection_state")
      .values({ name, ...values })
      .onConflict((oc) => oc.column("name").doUpdateSet(values))
      .execute();
  }
}

function toStoredEvent(row: Selectable<EventTable>): StoredEvent {
  return {
    id: row.id,
    position: Number(row.position),
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    version: Number(row.version),
    type: row.event_type,
    createdAt: row.created_at,
    metadata: decode(row.metadata) as EventMetadata,
    data: decode(row.data) as object,
  };
}

function toProjectionState(row: Selectable<ProjectionStateTable>): ProjectionState {
  return {
    name: row.name,
    position: Number(row.position),
    updatedAt: row.updated_at,
    failedPosition: row.failed_position === null ? null : Number(row.failed_position),
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
  };
}

function emptyProjectionState(name: string): ProjectionState {
  return { name, position: 0, updatedAt: null, failedPosition: null, lastError: null, lastErrorAt: null };
}

function isConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  if (error.code === "40001") return true;
  return error.code === "23505" && "constraint" in error && error.constraint === eventVersionConstraint;
}
