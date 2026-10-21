declare module "lowdb" {
  export class Low<T> {
    constructor(adapter: JSONFile<T>);
    data: T | null;
    read(): void;
    write(): void;
    get<K extends keyof T>(key: K): LowChain<T[K]>;
  }

  export class JSONFile<T> {
    constructor(filename: string);
  }

  interface LowChain<T> {
    value(): T;
    push(item: T extends (infer U)[] ? U : never): this;
    find(predicate: Partial<T extends (infer U)[] ? U : never>): LowItemChain<T extends (infer U)[] ? U : never>;
    assign(data: Partial<T extends (infer U)[] ? U : never>): this;
    write(): void;
  }

  interface LowItemChain<T> {
    value(): T | undefined;
    assign(data: Partial<T>): LowItemChain<T>;
    write(): void;
  }
}
