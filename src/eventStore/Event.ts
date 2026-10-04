export type EventMetadata = Record<string, unknown>;

export interface EventOptions {
  id?: string;
  createdAt?: Date;
  metadata?: EventMetadata;
  version?: number;
}

export class Event<Type extends string = string, Data extends object = object> {
  readonly id: string;
  readonly createdAt: Date;
  readonly metadata: EventMetadata;
  readonly version?: number;

  constructor(
    readonly aggregateId: string,
    readonly type: Type,
    readonly data: Data,
    options: EventOptions = {},
  ) {
    this.id = options.id ?? crypto.randomUUID();
    this.createdAt = options.createdAt ?? new Date();
    this.metadata = options.metadata ?? {};
    this.version = options.version;
  }

  get<Key extends keyof Data>(key: Key): Data[Key] {
    return this.data[key];
  }
}
