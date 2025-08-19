# Library Highlighting Feature Demo

This demo shows how the new library highlighting feature works in the Cross-Language Dependency Visualizer extension.

## Setup

1. Open the `test/TestLibrary.java` file in VS Code
2. Make sure the extension is activated (you should see the "Dependency Visualizer" icon in the activity bar)

## Expected Behavior

### Test Files

#### `test/TestLibrary.java`
The file contains three `System.loadLibrary()` calls:

```java
static {
    System.loadLibrary("calculator");  // Should be highlighted based on calculator.dll presence
    System.loadLibrary("mathlib");     // Should be highlighted based on mathlib.so presence  
    System.loadLibrary("graphics");    // Should be highlighted based on graphics library absence
}
```

#### `test/HelloJNI.java`
The file contains native method declarations:

```java
public class HelloJNI {
    static {
        System.loadLibrary("hello");  // Loads the native library
    }

    // Native method declaration - should be highlighted based on C++ implementation
    private native void sayHello();
    
    // Another native method - should be highlighted based on C++ implementation
    public native int add(int a, int b);
    
    // Native method with different signature
    public native String getMessage(String name);
}
```

#### `test/HelloJNI.cpp`
The file contains C++ implementations:

```cpp
// Implementation of sayHello method
JNIEXPORT void JNICALL Java_HelloJNI_sayHello(JNIEnv *env, jobject obj) {
    std::cout << "Hello from C++ via JNI!" << std::endl;
}

// Implementation of add method
JNIEXPORT jint JNICALL Java_HelloJNI_add(JNIEnv *env, jobject obj, jint a, jint b) {
    return a + b;
}

// Note: getMessage method is NOT implemented
```

### Sample Library Files

- `lib/calculator.dll` - Exists with correct extension for Windows
- `lib/mathlib.so` - Exists but wrong extension for Windows (should be .dll)
- `lib/graphics.*` - Missing entirely
- `lib/hello.dll` - Missing (needed for HelloJNI example)

## Beautiful Color Coding

Based on the current platform (Windows in this case):

1. **🔴 Red Highlighting with ❌ Icon**: `System.loadLibrary("graphics")`
   - Clean red background
   - Library file is missing entirely
   - Expected: `graphics.dll` for Windows
   - Shows ❌ icon after the highlighted text

2. **🔵 Blue Highlighting with ⚠️ Icon**: `System.loadLibrary("mathlib")`
   - Clean blue background
   - Library exists but has wrong extension
   - Found: `mathlib.so` (Linux extension)
   - Expected: `mathlib.dll` (Windows extension)
   - Shows ⚠️ icon after the highlighted text

3. **🟢 Green Highlighting with ✅ Icon**: `System.loadLibrary("calculator")`
   - Clean green background
   - Library exists with correct extension
   - Found: `calculator.dll` (correct for Windows)
   - Shows ✅ icon after the highlighted text

## Native Method Highlighting

The extension also highlights native method declarations with different colors:

1. **🟢 Green Highlighting with 🔗 Icon**: `private native void sayHello();`
   - Clean green background
   - C++ implementation found in `HelloJNI.cpp`
   - Expected JNI function: `Java_HelloJNI_sayHello`
   - Shows 🔗 icon after the highlighted text
   - **Click to navigate** to the C++ implementation file (prioritizes .cpp over .h files)

2. **🔴 Red Highlighting with 🔗❌ Icon**: `public native String getMessage(String name);`
   - Clean red background
   - C++ implementation missing
   - Expected JNI function: `Java_HelloJNI_getMessage`
   - Shows 🔗❌ icon after the highlighted text

### Visual Enhancements:
- **Clean backgrounds** for a modern look
- **Status icons** that appear after the highlighted text
- **Overview ruler indicators** for quick status identification
- **Cross-language linking** with 🔗 icons for native methods
- **Persistent highlighting** that stays visible when switching tabs

## Interactive Features

### Beautiful Hover Information
- Hover over any highlighted `System.loadLibrary()` call
- See beautifully formatted detailed information about the library status
- Includes colorful status badges, platform information, and actionable recommendations
- Rich markdown formatting with icons and structured layout
- **Native Methods**: Hover over native method declarations to see C++ implementation status
- **JNI Signatures**: View expected JNI function names and implementation details

### Enhanced Code Lens
- Look for beautiful code lens above the `System.loadLibrary()` calls
- Shows status icons and descriptive text (e.g., "❌ calculator • Missing")
- Click to see comprehensive library information and available actions
- **Native Methods**: Code lens above native method declarations shows implementation status
- **Go to Implementation**: Click on implemented methods to navigate directly to the C++ implementation file
- **Smart Navigation**: Prioritizes .cpp files over .h files for actual implementations
- **Header Detection**: Shows notification when navigating to header file declarations
- **Cross-language Info**: View JNI signatures and C++ implementation details

### Context Menu
- Right-click in the editor
- Select "Refresh Library Highlights" to update the highlighting

### Commands
- Use Command Palette (`Ctrl+Shift+P`)
- Search for "Dependency Visualizer: Refresh Library Highlights"
- Search for "Dependency Visualizer: Show Library Information"

## Platform Detection

The extension automatically detects your operating system:

- **Windows**: Expects `.dll` files
- **Linux**: Expects `.so` files  
- **macOS**: Expects `.dylib` files

## Library Search Paths

The extension searches for libraries in these locations:

1. Project directories:
   - `./lib/`
   - `./libs/`
   - `./native/`
   - `./bin/`
   - `./target/lib/`
   - `./build/lib/`

2. System directories:
   - Windows: `C:\Windows\System32\`
   - Linux: `/usr/lib/`, `/usr/local/lib/`
   - macOS: `/usr/lib/`, `/usr/local/lib/`

## Troubleshooting

If highlighting doesn't work as expected:

1. Check that the extension is activated
2. Verify library files are in expected locations
3. Use "Refresh Library Highlights" command
4. Check the Output panel for any error messages
5. Ensure Java files are properly recognized by VS Code 