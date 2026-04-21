import { describe, it, expect } from "vitest";
import { buildCypherForFile } from "./producer.js";
import type { ParsedFile } from "../parser/parser.js";

describe("buildCypherForFile", () => {
  it("produces MERGE File, Component, HAS_PROP without executing FalkorDB", () => {
    const parsed: ParsedFile = {
      path: "src/Button.tsx",
      imports: [],
      components: [
        { name: "Button", type: "Functional", isLegacy: false },
      ],
      hooksUsed: [],
      renders: [],
      propsByComponent: {
        Button: [
          { name: "label", required: true },
          { name: "onClick", required: false },
        ],
      },
      functions: [{ name: "formatLabel" }, { name: "handleClick" }],
      calls: [{ caller: "handleClick", callee: "formatLabel" }],
      unresolvedCalls: [],
      nestModules: [],
      nestControllers: [],
      nestHttpRoutes: [],
      nestServices: [],
      strapiContentTypes: [],
      strapiControllers: [],
      strapiServices: [],
    };
    const statements = buildCypherForFile(
      parsed,
      [],
      new Set(["src/Button.tsx"]),
      [],
      "test-project-id"
    );
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.some((s) => s.includes("MERGE (f:File") && s.includes("Button.tsx") && s.includes("projectId"))).toBe(true);
    expect(statements.some((s) => s.includes(":Component") && s.includes("Button"))).toBe(true);
    expect(statements.some((s) => s.includes("HAS_PROP") && s.includes("label"))).toBe(true);
    expect(statements.some((s) => s.includes("Prop") && s.includes("componentName"))).toBe(true);
    expect(statements.some((s) => s.includes(":Function") && s.includes("formatLabel"))).toBe(true);
    expect(statements.some((s) => s.includes("CALLS") && s.includes("handleClick") && s.includes("formatLabel"))).toBe(true);
  });
});
