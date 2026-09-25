import { API } from "typescript/unstable/sync";
import * as ts from "typescript/unstable/ast";
import { resolve, relative } from "node:path";

// Use the pinned compiler's resolver and type checker, including re-exports and
// dynamic imports. Type-only contracts do not create runtime dependency cycles.
const root = resolve(".");
const api = new API({ cwd: root });
const failures = [];
const graph = new Map();
const sourceRoot = resolve("src").toLowerCase() + "/";
try {
  const project = api
    .updateSnapshot({ openProjects: [resolve("tsconfig.app.json")] })
    .getProject(resolve("tsconfig.app.json"));
  for (const file of project.program.getSourceFileNames()) {
    if (!file.toLowerCase().startsWith(sourceRoot)) continue;
    const sf = project.program.getSourceFile(file);
    const name = relative(root, file).replaceAll("\\", "/").toLowerCase();
    const dependencies = new Set();
    graph.set(name, dependencies);
    const report = (node, message) =>
      failures.push(
        `${name}:${sf.text.slice(0, node.getStart()).split("\n").length}: ${message}`,
      );
    const edge = (literal, typeOnly = false) => {
      const symbol = project.checker.getSymbolAtLocation(literal);
      for (const declaration of symbol?.declarations ?? []) {
        const path = declaration.path;
        if (!path.startsWith(sourceRoot)) continue;
        const target = "src/" + path.slice(sourceRoot.length);
        if (!typeOnly) dependencies.add(target);
        if (
          (name.startsWith("src/application/") ||
            name.startsWith("src/presentation/")) &&
          (target.startsWith("src/adapters/") ||
            target.includes("/transport/web-bluetooth"))
        )
          report(
            literal,
            "Inject browser adapters at bootstrap; do not import them here.",
          );
        if (
          (name.startsWith("src/application/") ||
            name.startsWith("src/presentation/") ||
            name.startsWith("src/ui/")) &&
          /\/drivers\/coolled/.test(target)
        )
          report(literal, "Generic layers must not import concrete drivers.");
      }
    };
    const expressions = [];
    function visit(node) {
      if (ts.isImportDeclaration(node))
        edge(
          node.moduleSpecifier,
          Boolean(node.importClause?.isTypeOnly) ||
            Boolean(
              node.importClause?.namedBindings &&
              ts.isNamedImports(node.importClause.namedBindings) &&
              node.importClause.namedBindings.elements.every(
                (e) => e.isTypeOnly,
              ),
            ),
        );
      if (ts.isExportDeclaration(node) && node.moduleSpecifier)
        edge(
          node.moduleSpecifier,
          node.isTypeOnly ||
            Boolean(
              node.exportClause &&
              ts.isNamedExports(node.exportClause) &&
              node.exportClause.elements.every((e) => e.isTypeOnly),
            ),
        );
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0]
      )
        edge(node.arguments[0]);
      if (
        (name.startsWith("src/application/services/") ||
          name.startsWith("src/presentation/state/") ||
          name === "src/application/runtime.ts" ||
          name === "src/presentation/store.ts") &&
        ts.isClassDeclaration(node) &&
        node.heritageClauses?.some(
          (c) => c.token === ts.SyntaxKind.ExtendsKeyword,
        )
      )
        report(node, "Compose services instead of inheriting implementation.");
      if (
        name.startsWith("src/domain/") &&
        ts.isIdentifier(node) &&
        ["window", "document", "navigator", "localStorage"].includes(
          node.getText(),
        )
      )
        report(node, "Domain code must not depend on browser state.");
      if (
        ts.isExpressionStatement(node) &&
        ts.isCallExpression(node.expression)
      )
        expressions.push(node.expression);
      node.forEachChild(visit);
    }
    visit(sf);
    const types = project.checker.getTypeAtLocation(expressions);
    expressions.forEach((expression, i) => {
      const type = types[i];
      if (
        type &&
        project.checker.getPropertyOfType(type, "then") &&
        !(
          ts.isPropertyAccessExpression(expression.expression) &&
          expression.expression.name.getText() === "catch" &&
          expression.arguments.length > 0
        )
      )
        report(
          expression,
          "Promise is not handled: await, return, catch, or explicitly void a deliberately supervised operation.",
        );
    });
  }
  const completed = new Set(),
    active = new Set();
  function walk(file, trail = []) {
    if (active.has(file)) {
      failures.push(`Runtime import cycle: ${[...trail, file].join(" -> ")}`);
      return;
    }
    if (completed.has(file)) return;
    active.add(file);
    for (const next of graph.get(file) ?? []) walk(next, [...trail, file]);
    active.delete(file);
    completed.add(file);
  }
  for (const file of graph.keys()) walk(file);
} finally {
  api.close();
}
if (failures.length) {
  console.error([...new Set(failures)].join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "Resolved architecture boundaries and native TypeScript promise checks passed.",
  );
