import { type AggregateRoot, recordedEvents } from "./AggregateRoot";
import type { Command } from "./Command";
import type { Event, EventMetadata } from "./Event";
import type { EventStore } from "./EventStore";

export interface CommandHandlerOptions<C extends Command> {
  metadata?: (command: C) => EventMetadata;
}

export class CommandHandler<E extends Event, C extends Command, Tx = unknown> {
  constructor(
    private readonly store: EventStore<E, Tx>,
    private readonly create: (command: C) => AggregateRoot<E, C>,
    private readonly options: CommandHandlerOptions<C> = {},
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
    const metadata = this.options.metadata?.(command) ?? {};
    for (const event of events) Object.assign(event, { metadata: { ...metadata, ...event.metadata } });
    await this.store.append(events, { expectedVersion: history.length });
    return events;
  }
}
