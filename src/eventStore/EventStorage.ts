import type { EventMetadata } from "./Event";

export interface EventRecord {
  id: string;
  type: string;
  createdAt: Date;
  metadata: EventMetadata;
  data: object;
}

export interface StoredEvent extends EventRecord {
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
  /**
   * Appends events to a single aggregate stream. Versions start at 1 and are
   * contiguous per aggregate. Must throw a ConcurrencyError when
   * `expectedVersion` does not match the current version of the stream, or
   * when another writer appended to the stream concurrently.
   */
  append(events: EventRecord[], options: AppendOptions): Promise<void>;

  /** Loads events of an aggregate type in append order, optionally for a single aggregate. */
  load(aggregateType: string, aggregateId?: string): Promise<StoredEvent[]>;

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
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
