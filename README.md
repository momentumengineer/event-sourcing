# @momentumengineer/event-sourcing

Event sourcing building blocks: events, aggregates, command handlers and projections, with pluggable storage.

```sh
npm install @momentumengineer/event-sourcing
```

## Usage

```ts
import { AggregateRoot, CommandHandler, Event, EventStore, InMemoryEventStorage } from "@momentumengineer/event-sourcing";

type Incremented = Event<"Incremented", { by: number }>;
type Increment = { by: number };

class Counter extends AggregateRoot<Incremented, Increment> {
  count = 0;

  protected on(event: Incremented) {
    this.count += event.data.by;
  }

  handle(command: Increment) {
    if (this.count + command.by > 100) throw new Error("Counter cannot exceed 100");
    this.apply(new Event(this.id, "Incremented", { by: command.by }));
  }
}

const store = new EventStore<Incremented>({ storage: new InMemoryEventStorage(), aggregateType: "counter" });
const handler = new CommandHandler(store, (id) => new Counter(id));

await handler.handle("counter-1", { by: 2 });
```

`on` updates state, `apply` updates state and stages the event. The `CommandHandler` stores staged events once `handle` returns. Concurrent commands on the same aggregate throw a `ConcurrencyError`.

## Kysely (PostgreSQL)

```ts
import { createEventTable, KyselyEventStorage } from "@momentumengineer/event-sourcing/kysely";

await createEventTable(db); // once, e.g. in a migration
const storage = new KyselyEventStorage(db);
```

Projections receive the Kysely transaction:

```ts
const store = new EventStore({
  storage,
  aggregateType: "counter",
  projections: [{ name: "counters", reset: (trx) => …, project: (trx, event) => … }],
});
```

## License

MIT
