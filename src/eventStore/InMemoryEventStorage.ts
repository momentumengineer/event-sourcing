import {
  type AppendOptions,
  ConcurrencyError,
  type EventRecord,
  type EventStorage,
  type ProjectionState,
  type ProjectionStateStorage,
  type StoredEvent,
} from "./EventStorage";

export class InMemoryEventStorage implements EventStorage<undefined>, ProjectionStateStorage<undefined> {
  private readonly events: StoredEvent[] = [];
  private readonly projections = new Map<string, ProjectionState>();

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
        structuredClone({
          ...event,
          position: this.events.length + 1,
          aggregateType,
          aggregateId,
          version: version + index + 1,
        }),
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

  async loadAfter(position: number, limit: number, aggregateTypes?: string[]): Promise<StoredEvent[]> {
    return structuredClone(
      this.events
        .filter(
          (event) =>
            event.position > position &&
            (aggregateTypes === undefined || aggregateTypes.includes(event.aggregateType)),
        )
        .slice(0, limit),
    );
  }

  async transaction<T>(fn: (tx: undefined) => Promise<T>): Promise<T> {
    return fn(undefined);
  }

  async getProjectionState(name: string): Promise<ProjectionState> {
    return { ...this.state(name) };
  }

  async lockProjection(_tx: undefined, name: string): Promise<number> {
    return this.state(name).position;
  }

  async saveProjectionPosition(_tx: undefined, name: string, position: number): Promise<void> {
    this.projections.set(name, {
      name,
      position,
      updatedAt: new Date(),
      failedPosition: null,
      lastError: null,
      lastErrorAt: null,
    });
  }

  async saveProjectionError(name: string, position: number, error: string): Promise<void> {
    this.projections.set(name, {
      ...this.state(name),
      failedPosition: position,
      lastError: error,
      lastErrorAt: new Date(),
    });
  }

  private state(name: string): ProjectionState {
    return (
      this.projections.get(name) ?? {
        name,
        position: 0,
        updatedAt: null,
        failedPosition: null,
        lastError: null,
        lastErrorAt: null,
      }
    );
  }
}
