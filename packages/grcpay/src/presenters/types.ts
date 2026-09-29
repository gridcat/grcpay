import { JsonApiDocument, JsonApiLink, PresenterOptions } from 'yayson';

export type Attributes = { [key: string]: unknown };

export type Relationship<T> = { [key: string]: T };

export interface PresenterInterface {
  render(data: unknown, options?: PresenterOptions): JsonApiDocument;
  selfLinks?(instance: object): JsonApiLink | string | undefined;
  attributes?(instance: object | null): Attributes;
  id?(instance: object): string | undefined;
  type?: string;
}
