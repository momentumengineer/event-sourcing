import { AggregateRoot, Command, CommandHandler, Event, type EventOptions, EventStore, InMemoryEventStorage } from "../src";

export class Incremented extends Event<"Incremented", { by: number }> {
  constructor(aggregateId: string, by: number, options?: EventOptions) {
    super(aggregateId, "Incremented", { by }, options);
  }
}

export class CounterReset extends Event<"CounterReset", {}> {
  constructor(aggregateId: string) {
    super(aggregateId, "CounterReset", {});
  }
}

export type CounterEvent = Incremented | CounterReset;

export class Increment extends Command {
  constructor(
    aggregateId: string,
    readonly by: number,
  ) {
    super(aggregateId);
  }
}

export class Reset extends Command {}

export type CounterCommand = Increment | Reset;

export function increment(aggregateId: string, by: number): Increment {
  return new Increment(aggregateId, by);
}

export class Counter extends AggregateRoot<CounterEvent, CounterCommand> {
  count = 0;

  apply(event: CounterEvent) {
    switch (event.type) {
      case "Incremented":
        this.count += event.data.by;
        break;
      case "CounterReset":
        this.count = 0;
        break;
    }
  }

  handle(command: CounterCommand) {
    if (command instanceof Reset) return [new CounterReset(this.id)];
    if (this.count + command.by > 10) throw new Error("Counter cannot exceed 10");
    return [new Incremented(this.id, command.by)];
  }
}

export function setup(storage = new InMemoryEventStorage()) {
  const store = new EventStore<CounterEvent, undefined>({ storage, aggregateType: "counter" });
  const handler = new CommandHandler(store, (command: CounterCommand) => new Counter(command.aggregateId));
  return { storage, store, handler };
}
