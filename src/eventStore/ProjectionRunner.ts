import type { Event } from "./Event";
import {
  type EventStorage,
  eventFromStored,
  type ProjectionStateStorage,
  type StoredEvent,
} from "./EventStorage";
import type { Projection } from "./Projection";

export type ProjectionRunnerErrorHandler<E extends Event, Tx> = (
  error: unknown,
  projection: Projection<E, Tx>,
  event: StoredEvent,
) => void;

export interface ProjectionRunnerOptions<E extends Event, Tx> {
  storage: EventStorage<Tx> & ProjectionStateStorage<Tx>;
  projections: Projection<E, Tx>[];
  deserialize?: (stored: StoredEvent) => E;
  batchSize?: number;
  onError?: ProjectionRunnerErrorHandler<E, Tx>;
}

export class ProjectionRunner<E extends Event = Event, Tx = unknown> {
  private readonly storage: EventStorage<Tx> & ProjectionStateStorage<Tx>;
  private readonly projections: Projection<E, Tx>[];
  private readonly deserialize: (stored: StoredEvent) => E;
  private readonly batchSize: number;
  private readonly onError: ProjectionRunnerErrorHandler<E, Tx>;

  constructor(options: ProjectionRunnerOptions<E, Tx>) {
    this.storage = options.storage;
    this.projections = options.projections;
    this.deserialize = options.deserialize ?? eventFromStored<E>;
    this.batchSize = options.batchSize ?? 100;
    this.onError = options.onError ?? defaultErrorHandler;
  }

  async catchUp(): Promise<void> {
    for (const projection of this.projections) await this.catchUpProjection(projection);
  }

  async rebuild(name: string): Promise<void> {
    const projection = this.projections.find((p) => p.name === name);
    if (!projection) throw new Error(`Unknown projection ${name}`);

    await this.storage.transaction(async (tx) => {
      await this.storage.lockProjection(tx, name);
      await projection.reset(tx);
      await this.storage.saveProjectionPosition(tx, name, 0);
    });
    await this.catchUpProjection(projection);
  }

  private async catchUpProjection(projection: Projection<E, Tx>): Promise<void> {
    try {
      await this.runProjection(projection);
    } catch (error) {
      console.error(`Projection ${projection.name} could not catch up`, error);
    }
  }

  private async runProjection(projection: Projection<E, Tx>): Promise<void> {
    let { position } = await this.storage.getProjectionState(projection.name);
    while (true) {
      const events = await this.storage.loadAfter(position, this.batchSize, projection.aggregateTypes);
      if (events.length === 0) return;

      const next = await this.process(projection, position, events);
      if (next === undefined) return;
      position = next;
    }
  }

  private async process(
    projection: Projection<E, Tx>,
    from: number,
    events: StoredEvent[],
  ): Promise<number | undefined> {
    let current = events[0];
    try {
      return await this.storage.transaction(async (tx) => {
        const position = await this.storage.lockProjection(tx, projection.name);
        if (position !== from) return position;

        for (const event of events) {
          current = event;
          await projection.project(tx, this.deserialize(event));
        }
        const last = events[events.length - 1].position;
        await this.storage.saveProjectionPosition(tx, projection.name, last);
        return last;
      });
    } catch (error) {
      await this.fail(projection, current, error);
      return undefined;
    }
  }

  private async fail(projection: Projection<E, Tx>, event: StoredEvent, error: unknown): Promise<void> {
    try {
      this.onError(error, projection, event);
    } catch (handlerError) {
      console.error("Projection error handler failed", handlerError);
    }

    try {
      await this.storage.saveProjectionError(projection.name, event.position, describe(error));
    } catch (saveError) {
      console.error(`Could not save error state of projection ${projection.name}`, saveError);
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  return String(error);
}

function defaultErrorHandler(error: unknown, projection: Projection<Event, unknown>, event: StoredEvent): void {
  console.error(
    `Projection ${projection.name} failed at position ${event.position} (${event.aggregateType} ${event.type} ${event.id})`,
    error,
  );
}
