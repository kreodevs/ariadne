import { describe, it, expect } from "vitest";
import { parseSource } from "./parser.js";

describe("parseSource", () => {
  it("returns imports, components, hooks, renders and propsByComponent", () => {
    const source = `
import React from 'react';
export function Foo({ a, b }: { a: string; b?: number }) {
  const [x, setX] = React.useState(0);
  return <Bar />;
}
`;
    const parsed = parseSource("src/Foo.tsx", source);
    expect(parsed).not.toBeNull();
    expect(parsed!.imports.length).toBeGreaterThanOrEqual(1);
    expect(parsed!.components).toContainEqual(
      expect.objectContaining({ name: "Foo", type: "Functional" })
    );
    expect(parsed!.hooksUsed.some((h) => h.name === "useState")).toBe(true);
    expect(parsed!.renders).toContainEqual(
      expect.objectContaining({ componentName: "Bar" })
    );
    expect(parsed!.propsByComponent["Foo"]).toBeDefined();
    const props = parsed!.propsByComponent["Foo"];
    expect(props.map((p) => p.name).sort()).toEqual(["a", "b"]);
  });

  it("extracts props from function parameter destructuring", () => {
    const parsed = parseSource(
      "x.jsx",
      "function Comp({ title, count }) { return null; }"
    );
    expect(parsed?.propsByComponent["Comp"]?.map((p) => p.name)).toEqual([
      "title",
      "count",
    ]);
  });

  it("collects Context.Provider as render (isJsxComponentTag)", () => {
    const source = `
function PautaProvider({ children }) {
  return <PautaContext.Provider value={state}>{children}</PautaContext.Provider>;
}
`;
    const parsed = parseSource("src/usePauta.tsx", source);
    expect(parsed).not.toBeNull();
    expect(parsed!.components).toContainEqual(
      expect.objectContaining({ name: "PautaProvider", type: "Functional" })
    );
    expect(parsed!.renders).toContainEqual(
      expect.objectContaining({ componentName: "PautaContext.Provider" })
    );
  });
});
