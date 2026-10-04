import type { Event } from "./Event";

export interface Aggregate<E extends Event, C> {
  apply(event: E): void;
  handle(command: C): E[];
}
