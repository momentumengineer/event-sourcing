import { Event, type EventMetadata } from "./Event";

export interface EventRecord {
  id: string;
  type: string;
  createdAt: Date;
  metadata: EventMetadata;
  data: object;
}

export interface StoredEvent extends EventRecord {
  position: number;
  aggregateType: string;
  aggregateId: string;
  version: number;
}

export interface AppendOptions {
  aggregateType: string;
  aggregateId: string;
  expectedVersion?: number;
}

export interface EventStorage<Tx = unknown> {
  append(events: EventRecord[], options: AppendOptions): Promise<void>;

  load(aggregateType: string, aggregateId: string): Promise<StoredEvent[]>;

  loadAfter(position: number, limit: number, aggregateTypes?: string[]): Promise<StoredEvent[]>;

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface ProjectionState {
  name: string;
  position: number;
  updatedAt: Date | null;
  failedPosition: number | null;
  lastError: string | null;
  lastErrorAt: Date | null;
}

export interface ProjectionStateStorage<Tx = unknown> {
  getProjectionState(name: string): Promise<ProjectionState>;

  lockProjection(tx: Tx, name: string): Promise<number>;

  saveProjectionPosition(tx: Tx, name: string, position: number): Promise<void>;

  saveProjectionError(name: string, position: number, error: string): Promise<void>;
}

export class ConcurrencyError extends Error {
  constructor(
    readonly aggregateType: string,
    readonly aggregateId: string,
    readonly expectedVersion?: number,
  ) {
    super(
      expectedVersion === undefined
        ? `Concurrent append to ${aggregateType} ${aggregateId}`
        : `Expected ${aggregateType} ${aggregateId} to be at version ${expectedVersion}`,
    );
    this.name = "ConcurrencyError";
  }
}

export function eventFromStored<E extends Event>(stored: StoredEvent): E {
  return new Event(stored.aggregateId, stored.type, stored.data, {
    id: stored.id,
    createdAt: stored.createdAt,
    metadata: stored.metadata,
    version: stored.version,
  }) as E;
}
