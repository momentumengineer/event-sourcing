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
    aggregate.loadFromHistory(await this.store.loadAggregate(aggregateId));

    aggregate.handle(command);

    const events = aggregate.pullPendingEvents();
    if (events.some((event) => event.aggregateId !== aggregateId)) {
      throw new Error(`Aggregate ${aggregateId} applied an event for another aggregate`);
    }
    await this.store.append(events, { expectedVersion: aggregate.version });
    return events;
  }
}
