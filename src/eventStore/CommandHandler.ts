import { type AggregateRoot, recordedEvents } from "./AggregateRoot";
import type { Command } from "./Command";
import type { Event } from "./Event";
import type { EventStore } from "./EventStore";

export class CommandHandler<E extends Event, C extends Command, Tx = unknown> {
  constructor(
    private readonly store: EventStore<E, Tx>,
    private readonly create: (command: C) => AggregateRoot<E, C>,
  ) {}

  async handle(command: C): Promise<E[]> {
    const aggregate = this.create(command);
    const history = await this.store.loadAggregate(command.aggregateId);
    for (const event of history) aggregate.apply(event);

    aggregate.handle(command);

    const events = recordedEvents(aggregate);
    if (events.some((event) => event.aggregateId !== command.aggregateId)) {
      throw new Error(`Aggregate ${command.aggregateId} recorded an event for another aggregate`);
    }
    await this.store.append(events, { expectedVersion: history.length });
    return events;
  }
}
