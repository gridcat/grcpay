import EventEmitter from 'events';

const eventEmitter = new EventEmitter();

export const getEventEmitter = () => eventEmitter;
