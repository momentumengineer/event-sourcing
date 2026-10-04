import { Event } from "./Event";
import type { EventStorage, StoredEvent } from "./EventStorage";
import type { Projection } from "./Projection";

export type ProjectionErrorHandler<E extends Event, Tx> = (
  error: unknown,
  projection: Projection<E, Tx>,
  event: E,
) => void;

export interface EventStoreOptions<E extends Event, Tx> {
  storage: EventStorage<Tx>;
  aggregateType: string;
  projections?: Projection<E, Tx>[];
  /** Turns a stored event into your event type. Defaults to a plain `Event`. */
  deserialize?: (stored: StoredEvent) => E;
  /** Called when a projection fails after events were appended. Defaults to `console.error`. */
  onProjectionError?: ProjectionErrorHandler<E, Tx>;
}

export interface AppendEventsOptions {
  expectedVersion?: number;
}

export class EventStore<E extends Event, Tx = unknown> {
  readonly storage: EventStorage<Tx>;
  readonly aggregateType: string;
  private readonly projections: Projection<E, Tx>[];
  private readonly deserialize: (stored: StoredEvent) => E;
  private readonly onProjectionError: ProjectionErrorHandler<E, Tx>;

  constructor(options: EventStoreOptions<E, Tx>) {
    this.storage = options.storage;
    this.aggregateType = options.aggregateType;
    this.projections = options.projections ?? [];
    this.deserialize = options.deserialize ?? defaultDeserialize<E>;
    this.onProjectionError = options.onProjectionError ?? defaultProjectionErrorHandler;
  }

  /** Appends events of a single aggregate and runs the projections for them. */
  async append(events: E[], options: AppendEventsOptions = {}): Promise<void> {
    if (events.length === 0) return;

    const aggregateId = events[0].aggregateId;
    if (events.some((event) => event.aggregateId !== aggregateId)) {
      throw new Error("All appended events must belong to the same aggregate");
    }

    await this.storage.append(
      events.map((event) => ({
        id: event.id,
        type: event.type,
        createdAt: event.createdAt,
        metadata: event.metadata,
        data: event.data,
      })),
      { aggregateType: this.aggregateType, aggregateId, expectedVersion: options.expectedVersion },
    );

    for (const event of events) {
      for (const projection of this.projections) {
        try {
          await this.storage.transaction((tx) => projection.project(tx, event));
        } catch (error) {
          this.onProjectionError(error, projection, event);
        }
      }
    }
  }

  async loadAggregate(aggregateId: string): Promise<E[]> {
    const stored = await this.storage.load(this.aggregateType, aggregateId);
    return stored.map(this.deserialize);
  }

  async loadAllEvents(): Promise<E[]> {
    const stored = await this.storage.load(this.aggregateType);
    return stored.map(this.deserialize);
  }
}

function defaultDeserialize<E extends Event>(stored: StoredEvent): E {
  return new Event(stored.aggregateId, stored.type, stored.data, {
    id: stored.id,
    createdAt: stored.createdAt,
    metadata: stored.metadata,
    version: stored.version,
  }) as E;
}

function defaultProjectionErrorHandler(
  error: unknown,
  projection: Projection<Event, unknown>,
  event: Event,
): void {
  console.error(`Projection ${projection.name} failed for event ${event.id} (${event.type})`, error);
}
