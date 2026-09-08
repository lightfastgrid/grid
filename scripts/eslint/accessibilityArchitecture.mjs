import { dirname, resolve } from "node:path";

const CORE_SOURCE_MARKER = "/packages/core/src/";
const ACCESSIBILITY_DIRECTORY = "features/accessibility";
const ACCESSIBILITY_REGISTRY = "features/registry.ts";

const COMPOSITE_ROLES = new Set([
  "columnheader",
  "grid",
  "gridcell",
  "presentation",
  "row",
  "rowgroup",
  "treegrid",
]);

const COMPOSITE_ATTRIBUTES = new Set([
  "aria-activedescendant",
  "aria-colcount",
  "aria-colindex",
  "aria-colspan",
  "aria-multiselectable",
  "aria-owns",
  "aria-rowcount",
  "aria-rowindex",
  "aria-selected",
  "aria-sort",
]);

const COMPOSITE_PROPERTIES = new Set([
  "ariaActiveDescendantElement",
  "ariaActiveDescendantElements",
  "ariaColCount",
  "ariaColIndex",
  "ariaColSpan",
  "ariaMultiSelectable",
  "ariaOwnsElements",
  "ariaRowCount",
  "ariaRowIndex",
  "ariaSelected",
  "ariaSort",
]);

function normalizedPath(value) {
  return value.replaceAll("\\", "/");
}

function coreSourcePath(filename) {
  const normalized = normalizedPath(filename);
  const markerIndex = normalized.lastIndexOf(CORE_SOURCE_MARKER);
  return markerIndex < 0
    ? null
    : normalized.slice(markerIndex + CORE_SOURCE_MARKER.length);
}

function isAccessibilitySource(sourcePath) {
  return (
    sourcePath === ACCESSIBILITY_DIRECTORY ||
    sourcePath.startsWith(`${ACCESSIBILITY_DIRECTORY}/`)
  );
}

function isProductionSource(sourcePath) {
  return (
    !sourcePath.includes("/__tests__/") &&
    !sourcePath.includes("/__benchmarks__/") &&
    !sourcePath.includes(".test.") &&
    !sourcePath.includes(".test-d.")
  );
}

function resolvesToAccessibility(filename, specifier) {
  if (specifier.startsWith(".")) {
    const resolved = normalizedPath(resolve(dirname(filename), specifier));
    return (
      resolved.endsWith(`/${ACCESSIBILITY_DIRECTORY}`) ||
      resolved.includes(`/${ACCESSIBILITY_DIRECTORY}/`)
    );
  }

  return /(?:^|\/)features\/accessibility(?:\/|$)/.test(specifier);
}

function importSpecifier(node) {
  if (node === null || typeof node !== "object") return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (
    node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function unwrapExpression(node) {
  let current = node;
  while (
    current?.type === "TSAsExpression" ||
    current?.type === "TSSatisfiesExpression" ||
    current?.type === "TSNonNullExpression" ||
    current?.type === "TSTypeAssertion"
  ) {
    current = current.expression;
  }
  return current;
}

function createStaticStringResolver(sourceCode) {
  const resolveIdentifier = (identifier, resolving) => {
    let scope = sourceCode.getScope(identifier);
    while (scope !== null) {
      const variable = scope.set.get(identifier.name);
      if (variable !== undefined) {
        if (resolving.has(variable)) return null;
        const definition = variable.defs.find(
          (candidate) =>
            candidate.type === "Variable" &&
            candidate.parent?.kind === "const" &&
            candidate.node.init !== null,
        );
        if (definition === undefined) return null;

        resolving.add(variable);
        const value = resolveStaticString(definition.node.init, resolving);
        resolving.delete(variable);
        return value;
      }
      scope = scope.upper;
    }
    return null;
  };

  const resolveStaticString = (node, resolving = new Set()) => {
    const expression = unwrapExpression(node);
    if (expression === null || typeof expression !== "object") return null;
    if (
      expression.type === "Literal" &&
      typeof expression.value === "string"
    ) {
      return expression.value;
    }
    if (expression.type === "Identifier") {
      return resolveIdentifier(expression, resolving);
    }
    if (
      expression.type === "BinaryExpression" &&
      expression.operator === "+"
    ) {
      const left = resolveStaticString(expression.left, resolving);
      const right = resolveStaticString(expression.right, resolving);
      return left === null || right === null ? null : left + right;
    }
    if (expression.type === "TemplateLiteral") {
      let value = expression.quasis[0]?.value.cooked ?? "";
      for (let index = 0; index < expression.expressions.length; index += 1) {
        const substitution = resolveStaticString(
          expression.expressions[index],
          resolving,
        );
        if (substitution === null) return null;
        value += substitution;
        value += expression.quasis[index + 1]?.value.cooked ?? "";
      }
      return value;
    }
    return null;
  };

  return resolveStaticString;
}

function propertyName(node, staticString) {
  if (node === null || typeof node !== "object") return null;
  if (node.computed) return staticString(node.property);
  if (node.property?.type === "Identifier") return node.property.name;
  if (node.key?.type === "Identifier") return node.key.name;
  return staticString(node.key);
}

function accessibilityImportBoundaryRule() {
  return {
    meta: {
      type: "problem",
      docs: {
        description:
          "Keep accessibility-private modules behind the feature registry",
      },
      schema: [],
      messages: {
        privateImport:
          "Only packages/core/src/features/registry.ts may import accessibility-private modules.",
      },
    },
    create(context) {
      const filename = context.getFilename();
      const sourcePath = coreSourcePath(filename);
      if (
        sourcePath === null ||
        sourcePath === ACCESSIBILITY_REGISTRY ||
        isAccessibilitySource(sourcePath)
      ) {
        return {};
      }

      const check = (node, source) => {
        const specifier = importSpecifier(source);
        if (
          specifier !== null &&
          resolvesToAccessibility(filename, specifier)
        ) {
          context.report({ node, messageId: "privateImport" });
        }
      };

      return {
        ImportDeclaration: (node) => check(node, node.source),
        ExportAllDeclaration: (node) => check(node, node.source),
        ExportNamedDeclaration: (node) => check(node, node.source),
        ImportExpression: (node) => check(node, node.source),
        TSImportType: (node) =>
          check(node, node.source ?? node.argument ?? node.parameter),
        TSExternalModuleReference: (node) => check(node, node.expression),
        CallExpression(node) {
          if (
            node.callee.type === "Identifier" &&
            node.callee.name === "require"
          ) {
            check(node, node.arguments[0]);
          }
        },
      };
    },
  };
}

function compositeSemanticOwnershipRule() {
  return {
    meta: {
      type: "problem",
      docs: {
        description:
          "Keep composite-grid semantic attributes inside accessibility",
      },
      schema: [],
      messages: {
        compositeAttribute:
          "Composite-grid attribute '{{name}}' is owned by features/accessibility.",
        compositeRole:
          "Composite-grid role '{{role}}' is owned by features/accessibility.",
      },
    },
    create(context) {
      const sourcePath = coreSourcePath(context.getFilename());
      if (
        sourcePath === null ||
        !isProductionSource(sourcePath) ||
        isAccessibilitySource(sourcePath)
      ) {
        return {};
      }

      const staticString = createStaticStringResolver(context.sourceCode);

      const reportAttribute = (node, name) => {
        context.report({
          node,
          messageId: "compositeAttribute",
          data: { name },
        });
      };

      const checkRoleWrite = (node, role) => {
        if (role !== null && COMPOSITE_ROLES.has(role)) {
          context.report({
            node,
            messageId: "compositeRole",
            data: { role },
          });
        }
      };

      const checkProtectedProperty = (node, name) => {
        if (
          name !== null &&
          (COMPOSITE_ATTRIBUTES.has(name) ||
            COMPOSITE_PROPERTIES.has(name))
        ) {
          reportAttribute(node, name);
        }
      };

      return {
        CallExpression(node) {
          const calleeName =
            node.callee.type === "Identifier"
              ? node.callee.name
              : node.callee.type === "MemberExpression"
                ? propertyName(node.callee, staticString)
                : null;
          if (calleeName === "createDiv") {
            checkRoleWrite(node.arguments[1], staticString(node.arguments[1]));
          }

          for (const argument of node.arguments) {
            const name = staticString(argument);
            checkProtectedProperty(argument, name);
          }

          for (let index = 0; index < node.arguments.length - 1; index += 1) {
            if (staticString(node.arguments[index]) !== "role") {
              continue;
            }
            checkRoleWrite(
              node.arguments[index + 1],
              staticString(node.arguments[index + 1]),
            );
          }
        },
        Property(node) {
          const name = propertyName(node, staticString);
          checkProtectedProperty(node.key, name);
          if (name === "role") {
            checkRoleWrite(node.value, staticString(node.value));
          }
        },
        AssignmentExpression(node) {
          if (node.left.type !== "MemberExpression") return;
          const name = propertyName(node.left, staticString);
          checkProtectedProperty(node.left, name);
          if (name === "role") {
            checkRoleWrite(node.right, staticString(node.right));
          }
        },
        JSXAttribute(node) {
          const name =
            node.name.type === "JSXIdentifier" ? node.name.name : null;
          checkProtectedProperty(node.name, name);
          if (name === "role") {
            checkRoleWrite(
              node.value,
              node.value?.type === "Literal"
                ? staticString(node.value)
                : node.value?.type === "JSXExpressionContainer"
                  ? staticString(node.value.expression)
                  : null,
            );
          }
        },
      };
    },
  };
}

export const accessibilityArchitecturePlugin = {
  rules: {
    "accessibility-import-boundary": accessibilityImportBoundaryRule(),
    "composite-semantic-ownership": compositeSemanticOwnershipRule(),
  },
};

export default accessibilityArchitecturePlugin;
