/**
 * Boolean Cell V1 — Tests 20 and 36: durable allocation guard.
 *
 * The architecture states that activation resolution and mapped-source
 * resolution are allocation-free per call (§11.2, §11.4). Runtime monkey-
 * patching of `Object.*`/`Array.*` cannot prove that: it misses object
 * literals, array literals, closures, `new`, and spread copies entirely,
 * because those are syntax rather than function calls.
 *
 * This guard is therefore **structural**. It parses the real source files with
 * the TypeScript compiler API and walks the complete per-call body of every
 * function on the two hot paths, rejecting any allocating construct.
 *
 * Module-level constants and top-level function declarations are allowed —
 * they run once at module init, not per call.
 */

import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "../..");

const ACTIVATION_FILE = join(
  SRC,
  "features/editing/resolveCheckboxActivation.ts",
);
const MAPPED_FILE = join(SRC, "features/cell-shells/resolveShellValue.ts");
const FIELD_PATH_FILE = join(SRC, "internal/fieldPathSafety.ts");
const CELL_SHELL_MANAGER_FILE = join(
  SRC,
  "features/cell-shells/CellShellManager.ts",
);

/** Per-call hot paths, by file and by the functions reachable within them. */
const HOT_PATHS: { label: string; file: string; functions: string[] }[] = [
  {
    label: "activation resolution",
    file: ACTIVATION_FILE,
    functions: [
      "resolveCheckboxActivation",
      "hasBuiltInCheckboxShell",
      "hasCheckboxTypeSignal",
    ],
  },
  {
    label: "mapped-source resolution",
    file: MAPPED_FILE,
    functions: [
      "resolveShellValue",
      "resolveMappedSource",
      "lookupMapEntry",
      "isMappedSource",
      "isPlainObject",
      "readBaseValue",
    ],
  },
  {
    label: "field-path safety validation",
    file: FIELD_PATH_FILE,
    functions: ["isFieldPathSafe"],
  },
];

/** Collection constructors/methods that allocate a new object per call. */
const ALLOCATING_CALLS = new Set([
  "Object.create",
  "Object.assign",
  "Object.keys",
  "Object.values",
  "Object.entries",
  "Object.fromEntries",
  "Object.getOwnPropertyNames",
  "Array.from",
  "Array.of",
  "Object.freeze",
  "JSON.parse",
  "structuredClone",
]);

/** Array methods that materialize a new array. */
const ALLOCATING_METHODS = new Set([
  "map",
  "filter",
  "concat",
  "slice",
  "flat",
  "flatMap",
  "split",
]);

interface Finding {
  fn: string;
  kind: string;
  line: number;
  text: string;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ES2020,
    /* setParentNodes */ true,
  );
}

function findFunction(
  source: ts.SourceFile,
  name: string,
): ts.FunctionDeclaration | undefined {
  let found: ts.FunctionDeclaration | undefined;
  source.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node;
    }
  });
  return found;
}

/** Dotted callee text, e.g. `Object.create` or `arr.map`. */
function calleeText(node: ts.CallExpression, source: ts.SourceFile): string {
  return node.expression.getText(source);
}

function scanBody(
  fn: ts.FunctionDeclaration,
  fnName: string,
  source: ts.SourceFile,
): Finding[] {
  const findings: Finding[] = [];
  const body = fn.body;
  if (!body) return findings;

  const record = (node: ts.Node, kind: string) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({
      fn: fnName,
      kind,
      line: line + 1,
      text: node.getText(source).slice(0, 80).replace(/\s+/g, " "),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) record(node, "ObjectLiteralExpression");
    else if (ts.isArrayLiteralExpression(node)) record(node, "ArrayLiteralExpression");
    else if (ts.isArrowFunction(node)) record(node, "ArrowFunction");
    else if (ts.isFunctionExpression(node)) record(node, "FunctionExpression");
    else if (ts.isNewExpression(node)) record(node, "NewExpression");
    else if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) {
      record(node, "SpreadCopy");
    } else if (ts.isTemplateExpression(node)) {
      record(node, "TemplateExpression");
    } else if (ts.isCallExpression(node)) {
      const callee = calleeText(node, source);
      if (ALLOCATING_CALLS.has(callee)) {
        record(node, `AllocatingCall(${callee})`);
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (ALLOCATING_METHODS.has(method)) {
          record(node, `AllocatingMethod(${method})`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(body, visit);
  return findings;
}

describe("structural allocation guard for boolean-cell hot paths", () => {
  it.each(HOT_PATHS)(
    "$label allocates nothing per call",
    ({ file, functions }) => {
      const source = parse(file);
      const findings: Finding[] = [];

      for (const name of functions) {
        const fn = findFunction(source, name);
        // Every listed function must exist; a rename must fail the guard
        // rather than silently reduce coverage.
        expect(fn, `${name} not found in ${relative(SRC, file)}`).toBeDefined();
        findings.push(...scanBody(fn!, name, source));
      }

      expect(findings).toEqual([]);
    },
  );

  it("covers every exported and local function on the mapped path", () => {
    const source = parse(MAPPED_FILE);
    const declared: string[] = [];
    source.forEachChild((node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        declared.push(node.name.text);
      }
    });

    const guarded = new Set(
      HOT_PATHS.find((p) => p.file === MAPPED_FILE)!.functions,
    );
    // `resolveShellTone` is not on the mapped hot path (it is a separate
    // documented entry point) — everything else must be guarded.
    const unguarded = declared.filter(
      (n) => !guarded.has(n) && n !== "resolveShellTone",
    );
    expect(unguarded).toEqual([]);
  });

  it("covers every function declared on the activation path", () => {
    const source = parse(ACTIVATION_FILE);
    const declared: string[] = [];
    source.forEachChild((node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        declared.push(node.name.text);
      }
    });

    const guarded = new Set(
      HOT_PATHS.find((p) => p.file === ACTIVATION_FILE)!.functions,
    );
    expect(declared.filter((n) => !guarded.has(n))).toEqual([]);
  });

  it("uses the boolean eligibility helper on the checkbox presentation path", () => {
    const source = readFileSync(CELL_SHELL_MANAGER_FILE, "utf8");
    expect(source).toContain("isCellEditEligible(params)");
    expect(source).not.toContain("resolveCellEditEligibility(params)");
  });

  // ── Fault injection: the guard must catch each construct ─────────────
  //
  // Parses synthetic sources rather than mutating real files, so the guard's
  // detection is proven without touching production code.

  const FAULTS: [string, string, string][] = [
    ["object literal", "function f() { const x = {}; return x; }", "ObjectLiteralExpression"],
    ["array literal", "function f() { const x = []; return x; }", "ArrayLiteralExpression"],
    ["arrow closure", "function f() { const g = () => 1; return g(); }", "ArrowFunction"],
    [
      "function expression",
      "function f() { const g = function () { return 1; }; return g(); }",
      "FunctionExpression",
    ],
    ["new expression", "function f() { return new Map(); }", "NewExpression"],
    [
      "spread copy",
      "function f(o) { const c = { ...o }; return c; }",
      "SpreadCopy",
    ],
    [
      "array spread copy",
      "function f(a) { const c = [...a]; return c; }",
      "ArrayLiteralExpression",
    ],
    [
      "allocating call",
      "function f(o) { return Object.keys(o); }",
      "AllocatingCall(Object.keys)",
    ],
    [
      "allocating method",
      "function f(a) { return a.map(String); }",
      "AllocatingMethod(map)",
    ],
    [
      "template expression",
      "function f(a) { return `x${a}`; }",
      "TemplateExpression",
    ],
    [
      "nested allocation inside a branch",
      "function f(o) { if (o) { return { a: 1 }; } return null; }",
      "ObjectLiteralExpression",
    ],
  ];

  it.each(FAULTS)("detects an injected %s", (_label, code, expectedKind) => {
    const source = ts.createSourceFile(
      "fault.ts",
      code,
      ts.ScriptTarget.ES2020,
      true,
    );
    const fn = findFunction(source, "f");
    expect(fn).toBeDefined();
    const findings = scanBody(fn!, "f", source);
    expect(findings.map((f) => f.kind)).toContain(expectedKind);
  });

  it("does not flag allocation-free control flow", () => {
    const clean = `
      function f(o, key) {
        if (o === null || typeof o !== "object") return undefined;
        const proto = Object.getPrototypeOf(o);
        if (proto !== Object.prototype && proto !== null) return undefined;
        if (!Object.prototype.hasOwnProperty.call(o, key)) return undefined;
        const entry = o[key];
        return typeof entry === "string" ? entry : undefined;
      }
    `;
    const source = ts.createSourceFile("clean.ts", clean, ts.ScriptTarget.ES2020, true);
    expect(scanBody(findFunction(source, "f")!, "f", source)).toEqual([]);
  });
});
