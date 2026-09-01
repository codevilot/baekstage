import { describe, expect, it } from "vitest";
import type { SchemaChange } from "../../schema/types";
import { schemaGraphData } from "./SchemaGraph";

describe("schema impact graph", () => {
  it("connects changed objects to their table and draws foreign-key context", () => {
    const changes: SchemaChange[] = [
      { key: "table:public.orders", status: "added", fields: [{ name: "user_id", status: "added", after: "bigint" }], after: { key: "table:public.orders", kind: "table", schema: "public", name: "orders", definition: "CREATE TABLE public.orders (user_id bigint)", fields: [] } },
      { key: "constraint:public.orders.orders_user_id_fkey", status: "added", fields: [], after: { key: "constraint:public.orders.orders_user_id_fkey", kind: "constraint", schema: "public", name: "orders_user_id_fkey", parent: "public.orders", definition: "ALTER TABLE public.orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id)" } },
    ];

    const graph = schemaGraphData(changes);

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "table:public.orders", status: "added", subtitle: "1 column change" }),
      expect.objectContaining({ id: "table:public.users", status: "context" }),
    ]));
    expect(graph.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "table:public.orders", target: "constraint:public.orders.orders_user_id_fkey", kind: "owns" }),
      expect.objectContaining({ source: "table:public.orders", target: "table:public.users", kind: "references" }),
    ]));
  });
});
