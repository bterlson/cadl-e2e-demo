import { Container, CosmosClient, Database, Resource } from "@azure/cosmos";

interface Widget {
  name: string;
  color: "red" | "blue";
}
interface Person {
  id: string;
  name: string;
  age: number;
  favoriteSport: "baseball" | "football" | "soccer";
}

class EntityStore<T> {
  private client: CosmosClient;
  private databaseId: string;
  private collectionId: string;
  private container!: Container;
  private database!: Database;
  constructor(client: CosmosClient, databaseId: string, collectionId: string) {
    this.client = client;
    this.databaseId = databaseId;
    this.collectionId = collectionId;
  }

  async init() {
    const { database } = await this.client.databases.createIfNotExists({
      id: this.databaseId,
    });
    const { container } = await database.containers.createIfNotExists({
      id: this.collectionId,
    });
    this.database = database;
    this.container = container;
  }

  async get(id: string): Promise<(T & Resource) | undefined> {
    const { resource } = await this.container.item(id).read();
    return resource;
  }

  async find(query: string): Promise<(T & Resource)[]> {
    const { resources } = await this.container.items.query(query).fetchAll();
    return resources;
  }

  async findWhere(predicate: string): Promise<(T & Resource)[]> {
    const { resources } = await this.container.items
      .query(`select * from ${this.collectionId} where ${predicate}`)
      .fetchAll();
    return resources;
  }

  async findAll(): Promise<(T & Resource)[]> {
    return this.find(`select * from ${this.collectionId}`);
  }

  async add(item: T): Promise<T & Resource> {
    const { resource } = await this.container.items.create(item);
    return resource!;
  }

  async update(id: string, updatedItem: T): Promise<T & Resource> {
    const { resource } = await this.container.item(id).replace(updatedItem);
    return resource!;
  }

  async delete(id: string): Promise<void> {
    await this.container.item(id).delete();
  }
}

export class DataStore {
  private client: CosmosClient;
  public Widget: EntityStore<Widget>;
  public Person: EntityStore<Person>;
  constructor(endpoint: string, key: string) {
    this.client = new CosmosClient({ endpoint, key });
    this.Widget = new EntityStore<Widget>(this.client, "dbName", "Widget");
    this.Person = new EntityStore<Person>(this.client, "dbName", "Person");
  }

  async init() {
    await Promise.all([this.Widget.init(), this.Person.init()]);
  }
}
