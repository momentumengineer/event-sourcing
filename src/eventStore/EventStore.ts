import type { Event } from "./Event";
import { type EventStorage, eventFromStored } from "./EventStorage";

export interface EventStoreOptions<E extends Event, Tx> {
  storage: EventStorage<Tx>;
  aggregateType: string;
}

export interface AppendEventsOptions {
  expectedVersion?: number;
}

export class EventStore<E extends Event, Tx = unknown> {
  private readonly storage: EventStorage<Tx>;
  private readonly aggregateType: string;

  constructor(options: EventStoreOptions<E, Tx>) {
    this.storage = options.storage;
    this.aggregateType = options.aggregateType;
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
    return stored.map(eventFromStored<E>);
  }

  async loadAllEvents(): Promise<E[]> {
    const stored = await this.storage.load(this.aggregateType);
    return stored.map(eventFromStored<E>);
  }
}
