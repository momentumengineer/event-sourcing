import type { AggregateRoot } from "./AggregateRoot";
import type { Event } from "./Event";
import type { EventStore } from "./EventStore";

export class CommandHandler<E extends Event, C, Tx = unknown> {
  constructor(
    private readonly store: EventStore<E, Tx>,
    private readonly create: (aggregateId: string, command: C) => AggregateRoot<E, C>,
  ) {}

  async handle(aggregateId: string, command: C): Promise<E[]> {
    const aggregate = this.create(aggregateId, command);
    const history = await this.store.loadAggregate(aggregateId);
    for (const event of history) aggregate.apply(event);

    const events = aggregate.handle(command);
    await this.store.append(events, { expectedVersion: history.length });
    return events;
  }
}
