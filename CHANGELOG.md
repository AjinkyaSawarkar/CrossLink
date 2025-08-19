# Change Log

All notable changes to the "dependency-visualizer" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.1.0] - 2024-01-XX

### Added
- **Library Loading Code Highlighting**: New feature that highlights `System.loadLibrary()` calls with color-coded status
  - 🔴 Red highlighting for missing library files
  - 🔵 Blue highlighting for libraries with wrong extension for current platform
  - 🟢 Green highlighting for correctly configured libraries
  - Platform-aware detection (Windows: .dll, Linux: .so, macOS: .dylib)
  - Hover information with detailed library status
  - Code lens support for quick library information access
  - Context menu integration for refreshing highlights

### Enhanced
- Improved dependency analysis for cross-language projects
- Better constants management with enhanced naming suggestions
- Comprehensive dashboard with real-time statistics

## [1.0.0] - 2024-01-XX

### Added
- Initial release with basic dependency visualization
- Cross-language dependency analysis (Java/C++)
- JNI method matching and connection visualization
- Code refactoring tools for magic numbers and constants
- Native method refactoring capabilities