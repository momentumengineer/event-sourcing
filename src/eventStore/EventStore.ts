import type { Event } from "./Event";
import { type EventStorage, eventFromStored, type StoredEvent } from "./EventStorage";

export interface EventStoreOptions<E extends Event, Tx> {
  storage: EventStorage<Tx>;
  aggregateType: string;
  deserialize?: (stored: StoredEvent) => E;
}

export interface AppendEventsOptions {
  expectedVersion?: number;
}

export class EventStore<E extends Event, Tx = unknown> {
  readonly storage: EventStorage<Tx>;
  readonly aggregateType: string;
  private readonly deserialize: (stored: StoredEvent) => E;

  constructor(options: EventStoreOptions<E, Tx>) {
    this.storage = options.storage;
    this.aggregateType = options.aggregateType;
    this.deserialize = options.deserialize ?? eventFromStored<E>;
  }

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
