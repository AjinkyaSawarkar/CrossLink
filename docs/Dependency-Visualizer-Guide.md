# Cross-Language Dependency Visualizer — Technical Guide

This document consolidates how the VS Code extension works, its components, commands, and usage patterns. It references concrete files and symbols in this repository for accuracy.

---

## 1) Overview

- Name: "Cross-Language Dependency Visualizer"
- Purpose: Analyze and visualize dependencies across Java and C/C++ projects with a focus on JNI links between Java native methods and their C/C++ implementations.
- Entrypoints:
  - Extension manifest: `package.json`
  - Activation: `src/extension.ts`
  - Core analysis: `src/core/dependencyAnalyzer.ts`
  - UI views and webviews: `src/visualizer/` and `src/dashboard/`
  - Refactorings: `src/refactoring/`
  - Constants analysis UI: `src/constants/`
  - Library highlighting feature: `src/features/libraryHighlighter.ts`

---

## 2) Features (from `README.md` and code)

- Dependency analysis for Java (Maven/Gradle) and C++ (CMake/Conan/vcpkg)
- Dependency graph visualization via D3 webview
- Conflict/missing/platform issue detection
- JNI connection analysis (Java native methods ↔ C/C++ JNI functions)
- Java–C++ file connection list panel
- Project constants analysis and “apply” refactoring UI
- Library highlighting for `System.loadLibrary(...)` and native method implementation status
- Refactorings: rename, move/copy native methods, extract constants, generate JNI C++ stubs
- Dashboard control panel and statistics view

---

## 3) Commands and Views (from `package.json`)

- Views (container: `dependencyVisualizer`):
  - `dependencyVisualizerDashboard` (webview): Control Panel
  - `enhancedFileConnectionsList`: Java–C++ Connections
  - `constantsList`: Project Constants
  - Explorer view `dependencyTree`: Dependencies
  - `connectionStatistics`: Statistics

- Representative commands (subset):
  - `dependencyVisualizer.analyzeDependencies`
  - `dependencyVisualizer.showDependencyGraph`
  - `dependencyVisualizer.refreshAll`
  - `dependencyVisualizer.generateCppStub`
  - `dependencyVisualizer.showFileConnectionsList`
  - Constants: `dependencyVisualizer.showConstantsAnalysis`, `dependencyVisualizer.applySuggestion`, `dependencyVisualizer.refreshConstants`, etc.
  - Library highlighting: `dependencyVisualizer.refreshLibraryHighlights`, `dependencyVisualizer.showLibraryInfo`
  - Refactoring: `dependencyVisualizer.refactor`, `dependencyVisualizer.rename`, `dependencyVisualizer.moveNativeMethod`, `dependencyVisualizer.extractConstant`

---

## 4) Architecture and Data Flow

- Activation (`src/extension.ts`):
  - Instantiates `DependencyAnalyzer`, tree providers, webviews (`WebviewProvider`, `StatisticsViewProvider`, `DashboardProvider`), constants analyzer/UI, library highlighter, and refactoring provider.
  - Sets VS Code context `dependencyVisualizer.hasProjects` to enable views.
  - Registers file watchers to auto-refresh connections, statistics, and constants on changes.

- Analysis pipeline (`src/core/dependencyAnalyzer.ts`):
  - Project discovery: `findJavaProjects()` → `pom.xml` / `build.gradle*`; `findCppProjects()` → `CMakeLists.txt` / `conanfile.*` / `vcpkg.json`.
  - Dependency parsing via `JavaParser` and `CppParser`.
  - Issues detection via `ConflictDetector` and `PlatformChecker`.
  - JNI connections: `getFileConnections()` scans Java native methods and searches for matching C/C++ JNI function symbols.

- Visualization (`src/visualizer/webviewProvider.ts`):
  - `WebviewProvider.showDependencyGraph()` opens a D3 graph webview.
  - `createGraphData()` builds nodes/links from projects and augments with cross-language edges from `DependencyAnalyzer.getFileConnections()`.
  - Unmatched JNI methods produce synthetic "Missing JNI" nodes for visibility.

- Dashboard (`src/dashboard/dashboardProvider.ts`):
  - Control hub that triggers analyses and opens focused panels for file connections and constants.
  - Tracks context-aware refactoring availability using `RefactoringProvider.getAvailableRefactorings(...)` and posts status to the webview.

- Statistics (`src/visualizer/statisticsViewProvider.ts`):
  - Sidebar panel shows connection rate, connected/missing methods, unique Java/C++ files, and estimated package count.
  - Updates from `DependencyAnalyzer.getFileConnections()`.

---

## 5) Key Components

### 5.1 `DependencyAnalyzer` — `src/core/dependencyAnalyzer.ts`

- Discovers projects, parses dependencies, detects conflicts/missing/platform issues.
- Exposes `getProjects()` and diagnostics for consumers.
- JNI mapping:
  - `getFileConnections()` → returns `[ { javaFile, cppFile, methodName, isMatched, details } ]`
  - `extractNativeMethods(document)` finds Java native methods.
  - `findMatchingCppImplementation(method)` scans C/C++ files for `JNIEXPORT ... JNICALL Java_pkg_Class_method`.

### 5.2 Graph Webview — `src/visualizer/webviewProvider.ts`

- `WebviewProvider.showDependencyGraph()` renders the graph (D3) with projects and dependencies.
- Adds cross-language links: Java file ↔ C++ file when matched; otherwise links to a synthetic "Missing JNI" node.

### 5.3 Library Highlighting — `src/features/libraryHighlighter.ts`

- Persistent, interactive editor decorations and code lenses for Java files.
- Highlights `System.loadLibrary("...")` as Missing / Wrong Extension / Correct.
- Highlights native methods as Implemented / Missing Implementation after scanning for JNI implementations.
- Provides hovers with status details and code-lens actions (open info / go to implementation).
- Commands: `dependencyVisualizer.refreshLibraryHighlights`, `dependencyVisualizer.showLibraryInfo`, `dependencyVisualizer.goToImplementation`.

### 5.4 Constants Analysis Webview — `src/constants/constantsWebviewProvider.ts`

- `showConstantsAnalysis()` opens a panel showing constants with search, per-file grouping, and one-click Apply.
- `applyConstant(index)` inserts a declaration (Java or C/C++) and replaces numeric literals throughout the file with the chosen constant name.
- Integrates with `ConstantsAnalyzer` for data and with `dependencyVisualizer.applySuggestion` for rename-like refactors.

### 5.5 Dashboard — `src/dashboard/dashboardProvider.ts`

- View ID: `dependencyVisualizerDashboard`.
- Handles webview messages:
  - `showDependencies` → run analysis then `dependencyVisualizer.showDependencyGraph`.
  - `showFileConnections` → compute connections and open an interactive connections panel.
  - `showConstants` → analyze constants and open an interactive constants panel.
  - `executeRefactoring` → triggers `dependencyVisualizer.refactor` if available.
  - `refreshAll` → orchestrates all of the above.
- Panels:
  - File connections panel supports Open File, Generate C++ Stub, and inline rename of constants.
  - Constants panel supports Open File, Apply Suggestion, Copy to Clipboard, and inline rename.

### 5.6 Statistics View — `src/visualizer/statisticsViewProvider.ts`

- View ID: `connectionStatistics`.
- Computes:
  - Total, Connected, Missing, Percentage (connection rate)
  - Unique Java file count, unique C++ file count
  - Approximate unique package count from `src/main/java/...` paths
- Refresh button posts `{ type: 'refresh' }` to recompute via `DependencyAnalyzer.getFileConnections()`.

### 5.7 Refactoring Provider — `src/refactoring/refactoringProvider.ts`

- Registers and executes refactoring operations implementing `RefactoringOperation`.
- `getAvailableRefactorings(context)` asks each operation if it applies at current cursor/context.
- Used by the dashboard to enable/disable refactor button.

### 5.8 Native Method Copier — `src/refactoring/nativeMethodCopier.ts`

- Refactoring to copy a Java native method to another class and create a corresponding JNI C++ implementation.
- Flow:
  1. `canApply()` detects cursor on a native method.
  2. Extracts method info (class, package, name, params, return type).
  3. Prompts to select a target Java file.
  4. Inserts the native method declaration in the target class (before last `}`).
  5. Locates or creates a C++ file (via `DependencyAnalyzer.getFileConnections()` or folder/name heuristics) and appends a generated JNI stub.

---

## 6) Usage Flows

- Visualizing Dependencies:
  1. From the dashboard (Control Panel), click to analyze dependencies.
  2. Opens the graph webview (`WebviewProvider`) with project and dependency nodes plus JNI connection overlays.

- Inspecting Java–C++ Connections:
  1. From the dashboard, open the connections panel.
  2. Interact with file groups, open source files, or generate C++ stubs for unmatched native methods.

- Managing Constants:
  1. From the dashboard or constants view, open the constants analysis.
  2. Use search/grouping; click Apply to insert a declaration and replace literals.

- Library Highlighting:
  1. Open a Java file. The feature auto-highlights libraries and native methods.
  2. Hover for details or use code lenses (e.g., Go to Implementation).

- Refactoring (e.g., Copy Native Method):
  1. Place the cursor on a Java native method.
  2. Trigger `dependencyVisualizer.refactor` and select “Copy Native Method”.
  3. Select target Java file; a JNI stub is generated/updated in C++.

---

## 7) File/Directory Index (selected)

- `package.json` — contributes commands, views, configuration
- `src/extension.ts` — activation, providers, commands, watchers
- `src/core/dependencyAnalyzer.ts` — project discovery, dependency parsing, JNI links
- `src/visualizer/webviewProvider.ts` — D3 dependency graph webview
- `src/visualizer/statisticsViewProvider.ts` — connection statistics sidebar
- `src/dashboard/dashboardProvider.ts` — dashboard webview (control panel + panels)
- `src/features/libraryHighlighter.ts` — library/natives decorations, hovers, codelens
- `src/constants/constantsWebviewProvider.ts` — constants analysis panel
- `src/refactoring/nativeMethodCopier.ts` — copy native method + generate JNI stub

---

## 8) Limitations and Notes

- Some regex-based JNI parsing and package derivation are simplified heuristics.
- Paths and project discovery assume common layouts (`src/main/java`, typical C++ directories); adjust for nonstandard structures.
- The constants “apply” logic uses literal matching with boundary checks; complex cases may require manual review.

---

## 9) Getting Started (Development)

- Node.js required for building from source.
- Scripts: `npm run compile`, `npm run watch` (see `package.json`).
- Launch in VS Code with the extension host to test views, commands, and features.

---

© This guide is generated from the current repository state to ensure accuracy of file references and behaviors.
