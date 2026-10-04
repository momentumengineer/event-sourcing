import {
  type AppendOptions,
  ConcurrencyError,
  type EventRecord,
  type EventStorage,
  type StoredEvent,
} from "./EventStorage";

/** Non-durable storage for tests and examples. Transactions are not isolated; events are copied in and out. */
export class InMemoryEventStorage implements EventStorage<undefined> {
  private readonly events: StoredEvent[] = [];

  async append(events: EventRecord[], options: AppendOptions): Promise<void> {
    const { aggregateType, aggregateId, expectedVersion } = options;
    const version = this.events.filter(
      (event) => event.aggregateType === aggregateType && event.aggregateId === aggregateId,
    ).length;
    if (expectedVersion !== undefined && expectedVersion !== version) {
      throw new ConcurrencyError(aggregateType, aggregateId, expectedVersion);
    }

    events.forEach((event, index) => {
      this.events.push(
        structuredClone({ ...event, aggregateType, aggregateId, version: version + index + 1 }),
      );
    });
  }

  async load(aggregateType: string, aggregateId?: string): Promise<StoredEvent[]> {
    return structuredClone(
      this.events.filter(
        (event) =>
          event.aggregateType === aggregateType &&
          (aggregateId === undefined || event.aggregateId === aggregateId),
      ),
    );
  }

  async transaction<T>(fn: (tx: undefined) => Promise<T>): Promise<T> {
    return fn(undefined);
  }
}
