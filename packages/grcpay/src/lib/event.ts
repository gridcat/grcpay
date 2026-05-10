import EventEmitter from 'events';

type Types = 'log';

const eventEmitter = new EventEmitter();

export function getEventEmitter<T>(): {
  on: (a: Types, b: (c: T) => unknown) => unknown,
  emit: (a: Types, b: T) => unknown,
  } {
  return eventEmitter;
}
