# Cross-Language Dependency Visualizer

A comprehensive VS Code extension for analyzing and visualizing dependencies in Java and C/C++ projects, with special focus on cross-language dependencies and JNI (Java Native Interface) connections.

## Features

### 🔍 Dependency Analysis & Visualization
- **Multi-language support**: Analyzes Java (Maven/Gradle) and C++ (CMake/Conan/vcpkg) projects
- **Dependency tree visualization**: Shows project dependencies in a hierarchical tree view
- **Conflict detection**: Identifies version conflicts and missing libraries
- **Platform compatibility checking**: Detects platform-specific issues (Windows/Linux/macOS)

### 🔗 Cross-Language Connection Analysis
- **JNI method matching**: Automatically finds connections between Java native methods and their C++ implementations
- **File connection visualization**: Shows which Java files connect to which C++ files
- **Missing implementation detection**: Identifies Java native methods without corresponding C++ stubs
- **Connection statistics**: Provides metrics on cross-language dependencies

### 🎨 Cross-Language Code Highlighting
- **Library Loading**: Highlights `System.loadLibrary()` calls with different colors based on OS compatibility and file presence
- **Native Method Linking**: Highlights native method declarations and checks for corresponding C++ implementations
- **Color-coded status**:
  - 🔴 **Red**: Library file is missing or native method implementation is missing
  - 🔵 **Blue**: Library exists but has wrong extension for current platform
  - 🟢 **Green**: Library exists with correct extension or native method has C++ implementation
- **Platform detection**: Automatically detects OS and expects appropriate library extensions:
  - Windows: `.dll`
  - Linux: `.so`
  - macOS: `.dylib`
- **JNI Signature Detection**: Automatically generates expected JNI function names for native methods
- **Cross-language validation**: Checks C++ files for matching JNI function implementations
- **Hover information**: Detailed information about library status and native method implementation when hovering over highlighted code
- **Code lens**: Shows library status and native method status directly in the editor with clickable actions

### 🔧 Code Refactoring Tools
- **Magic number detection**: Finds hardcoded numbers that should be constants
- **Constant extraction**: Converts magic numbers to named constants with intelligent naming suggestions
- **Native method refactoring**: Helps move and reorganize JNI methods
- **Symbol renaming**: Cross-language aware renaming capabilities
- **C++ stub generation**: Automatically generates C++ implementation stubs for Java native methods

### 📊 Constants Management
- **Constants analyzer**: Scans for constants across Java and C++ files
- **Naming suggestions**: Provides intelligent constant naming based on context and usage
- **Magic number identification**: Detects numbers that should be extracted as constants
- **Context-aware categorization**: Groups constants by type, file, or usage context

### 🎛️ Interactive Dashboard
- **Webview-based control panel**: Modern UI for managing all features
- **Real-time statistics**: Shows dependency counts, connection metrics, and constants analysis
- **Search and filtering**: Advanced filtering capabilities for all data
- **Quick actions**: Context menus for common refactoring operations

## Requirements

- Visual Studio Code 1.74.0 or higher
- Java projects with native dependencies (JNI)
- C++ projects that interface with Java
- Node.js for development (if building from source)

## Usage

### Library Highlighting Feature

The extension automatically highlights `System.loadLibrary()` calls in Java files with different colors:

1. **Open a Java file** containing `System.loadLibrary()` calls
2. **Hover over the highlighted code** to see detailed information
3. **Click on code lens** (if available) to see library information
4. **Right-click** in the editor and select "Refresh Library Highlights" to update

#### Example:
```java
public class HelloJNI {
    static {
        System.loadLibrary("hello");  // Highlighted based on file presence
    }

    // Native method declarations - highlighted based on C++ implementation
    private native void sayHello();           // Green if implemented in C++
    public native int add(int a, int b);      // Green if implemented in C++
    public native String getMessage(String name); // Red if not implemented in C++
}
```

#### Color Meanings:
- 🔴 **Red**: Library file is missing OR native method has no C++ implementation
- 🔵 **Blue**: Library exists but has wrong extension for current platform
- 🟢 **Green**: Library exists with correct extension OR native method has C++ implementation
- 🔗 **Link Icon**: Indicates cross-language connection (native methods)

## Extension Settings

This extension contributes the following settings:

* `dependencyVisualizer.autoRefresh`: Automatically refresh dependencies when build files change (default: true)
* `dependencyVisualizer.showPlatformWarnings`: Show platform compatibility warnings (default: true)

# Running the Cross-Language Dependency Visualizer Extension

Launch Extension Host

1. Open the project folder in VS Code
2. Press **F5** (or go to **Run → Start Debugging**)
3. A new VS Code window will open with the extension loaded
4. Open any java file from a JNI project.




## Release Notes

### 1.1.0

- **NEW**: Added library loading code highlighting feature
  - Color-coded highlighting for `System.loadLibrary()` calls
  - Platform-aware library file detection
  - Hover information and code lens support
  - Automatic OS detection and extension validation
- Enhanced dependency analysis for cross-language projects
- Improved constants management with better naming suggestions
- Added comprehensive dashboard with real-time statistics

### 1.0.0

Initial release with basic dependency visualization and refactoring tools.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
