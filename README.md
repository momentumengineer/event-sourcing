# @momentumengineer/event-sourcing

Event sourcing building blocks: events, aggregates, command handlers and projections, with pluggable storage.

```sh
npm install @momentumengineer/event-sourcing
```

## Usage

```ts
import { CommandHandler, Event, EventStore, InMemoryEventStorage } from "@momentumengineer/event-sourcing";

class Counter {
  count = 0;
  constructor(readonly id: string) {}
  apply(event: Event) { this.count += (event.data as { by: number }).by; }
  handle(command: { by: number }) { return [new Event(this.id, "Incremented", { by: command.by })]; }
}

const store = new EventStore({ storage: new InMemoryEventStorage(), aggregateType: "counter" });
const handler = new CommandHandler(store, (id) => new Counter(id));

await handler.handle("counter-1", { by: 2 });
```

Concurrent commands on the same aggregate throw a `ConcurrencyError`.

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
