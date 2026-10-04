import { AggregateRoot, Command, CommandHandler, Event, EventStore, InMemoryEventStorage } from "../src";

export type Incremented = Event<"Incremented", { by: number }>;
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

export class Counter extends AggregateRoot<Incremented, CounterCommand> {
  count = 0;

  apply(event: Incremented) {
    this.count += event.data.by;
  }

  handle(command: CounterCommand) {
    if (command instanceof Reset) return [new Event(this.id, "Incremented", { by: -this.count })];
    if (this.count + command.by > 10) throw new Error("Counter cannot exceed 10");
    return [new Event(this.id, "Incremented", { by: command.by })];
  }
}

export function setup(storage = new InMemoryEventStorage()) {
  const store = new EventStore<Incremented, undefined>({ storage, aggregateType: "counter" });
  const handler = new CommandHandler(store, (command: CounterCommand) => new Counter(command.aggregateId));
  return { storage, store, handler };
}
