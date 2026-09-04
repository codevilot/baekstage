// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ScenarioEditor } from "./ScenarioEditor";

const scenario = { id: "checkout", title: "Checkout", nodes: [{ id: "cart", title: "Cart ready", kind: "screen" as const }], edges: [] };
const parts = [{ id: "login", title: "Login", inputs: [{ id: "email", title: "Email", type: "string" as const, defaultValue: "guest@example.com" }], expectations: [{ id: "heading", title: "Heading", type: "string" as const, defaultValue: "Home" }], outcomes: [{ id: "authenticated", title: "Authenticated" }, { id: "denied", title: "Denied" }], nodes: [{ id: "form", title: "Form", kind: "screen" as const }], edges: [] }];

describe("ScenarioEditor", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("edits a manual Node and adds a reusable Part as different item types", async () => {
    const onSaved = vi.fn(); let body: any;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => { body = JSON.parse(String(init?.body)); return { ok: true, json: async () => ({ scenario: { ...scenario, title: "Checkout edited" }, files: [".baekstage/scenario-edits/checkout.json"] }) }; }));
    render(<ScenarioEditor scenario={scenario} parts={parts} onClose={vi.fn()} onSaved={onSaved}/>);
    await userEvent.click(screen.getByText("Cart ready"));
    await userEvent.clear(screen.getByLabelText("이름")); await userEvent.type(screen.getByLabelText("이름"), "Cart prepared");
    await userEvent.click(screen.getByRole("button", { name: "Login 뒤에 추가" }));
    expect(screen.getByText("PART INSTANCE · login")).toBeVisible();
    expect(screen.getByText("MANUAL NODE · screen")).toBeVisible();
    await userEvent.clear(screen.getByLabelText("입력값 Email")); await userEvent.type(screen.getByLabelText("입력값 Email"), "member@example.com");
    await userEvent.clear(screen.getByLabelText("기대값 Heading")); await userEvent.type(screen.getByLabelText("기대값 Heading"), "Dashboard");
    await userEvent.selectOptions(screen.getByLabelText("Authenticated 다음 항목"), "node-cart");
    await userEvent.click(screen.getByRole("button", { name: "실행하고 저장" }));
    expect(body.items).toEqual([expect.objectContaining({ type: "node", node: expect.objectContaining({ title: "Cart prepared" }) }), expect.objectContaining({ type: "part", partId: "login" })]);
    expect(body.items[1]).toMatchObject({ inputs: { email: "member@example.com" }, expectations: { heading: "Dashboard" } });
    expect(body.routes).toEqual([{ fromItemId: body.items[1].id, outcome: "authenticated", toItemId: "node-cart" }]);
    expect(onSaved).toHaveBeenCalled();
  });

  it("creates a scenario from Map-style editing and inserts a Part before the selected Node", async () => {
    let body: any;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => { body = JSON.parse(String(init?.body)); return { ok: true, json: async () => ({ scenario: { id: body.id, title: body.title, nodes: [], edges: [] }, files: [] }) }; }));
    render(<ScenarioEditor creating scenario={{ id: "new-scenario", title: "", nodes: [], edges: [] }} parts={parts} onClose={vi.fn()} onSaved={vi.fn()}/>);
    expect(screen.getByRole("button", { name: "시나리오 생성" })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Scenario ID")); await userEvent.type(screen.getByLabelText("Scenario ID"), "new-checkout");
    await userEvent.type(screen.getByLabelText("시나리오 이름"), "New checkout");
    await userEvent.click(screen.getByRole("button", { name: /수동 Node 추가/ }));
    await userEvent.click(screen.getByRole("button", { name: "Login 앞에 추가" }));
    await userEvent.click(screen.getByRole("button", { name: "실행하고 생성" }));
    expect(body.id).toBe("new-checkout"); expect(body.items.map((item: any) => item.type)).toEqual(["part", "node"]);
  });

  it("blocks saving and explains a missing required Part input", async () => {
    const requiredParts = [{ ...parts[0], inputs: [{ id: "email", title: "Email", type: "string" as const, required: true }] }];
    render(<ScenarioEditor creating scenario={{ id: "required", title: "Required", nodes: [], edges: [] }} parts={requiredParts} onClose={vi.fn()} onSaved={vi.fn()}/>);
    await userEvent.click(screen.getByRole("button", { name: "Login 뒤에 추가" }));
    expect(screen.getByRole("alert")).toHaveTextContent("expected string (required)");
    expect(screen.getByRole("button", { name: "실행하고 생성" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("입력값 Email"), "user@example.com");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "실행하고 생성" })).toBeEnabled();
  });
});
