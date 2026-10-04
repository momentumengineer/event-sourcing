import type { Event } from "./Event";

export abstract class AggregateRoot<E extends Event, C> {
  private pendingEvents: E[] = [];
  private loadedVersion = 0;

  constructor(readonly id: string) {}

  get version(): number {
    return this.loadedVersion;
  }

  protected abstract on(event: E): void;

  abstract handle(command: C): void;

  protected apply(event: E): void {
    this.on(event);
    this.pendingEvents.push(event);
  }

  loadFromHistory(events: E[]): void {
    for (const event of events) this.on(event);
    this.loadedVersion += events.length;
  }

  pullPendingEvents(): E[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }
}
