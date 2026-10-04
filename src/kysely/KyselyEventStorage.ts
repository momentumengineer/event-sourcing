import type { Kysely, Selectable, Transaction } from "kysely";
import type { EventMetadata } from "../eventStore/Event";
import {
  type AppendOptions,
  ConcurrencyError,
  type EventRecord,
  type EventStorage,
  type StoredEvent,
} from "../eventStore/EventStorage";
import { type EventDatabase, type EventTable, eventVersionConstraint } from "./EventTable";
import { decode, encode } from "./json";

export class KyselyEventStorage<DB = unknown> implements EventStorage<Transaction<DB>> {
  private readonly events: Kysely<EventDatabase>;

  constructor(private readonly db: Kysely<DB>) {
    this.events = db as unknown as Kysely<EventDatabase>;
  }

  async append(events: EventRecord[], options: AppendOptions): Promise<void> {
    if (events.length === 0) return;
    const { aggregateType, aggregateId, expectedVersion } = options;

    try {
      await this.events
        .transaction()
        .execute(async (trx) => {
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
        });
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

  transaction<T>(fn: (tx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(fn);
  }
}

function toStoredEvent(row: Selectable<EventTable>): StoredEvent {
  return {
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    version: Number(row.version),
    type: row.event_type,
    createdAt: row.created_at,
    metadata: decode(row.metadata) as EventMetadata,
    data: decode(row.data) as object,
  };
}

function isConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  if (error.code === "40001") return true;
  return error.code === "23505" && "constraint" in error && error.constraint === eventVersionConstraint;
}
