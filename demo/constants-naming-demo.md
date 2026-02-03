# Improved Constant Naming Suggestions Demo

This demo showcases the enhanced constant naming suggestions feature in the Cross-Language Dependency Visualizer extension.

## 🚀 **Key Improvements**

### **1. Focused Magic Number Detection** ✨ UPDATED
- **Only detects numbers in comparisons**: `if (count < 5)` → suggests `MAX_COUNT`
- **Only detects numbers in loops**: `for (i = 0; i < 10; i++)` → suggests `MAX_ITERATIONS`
- **Context-aware suggestions**: Uses variable names to generate meaningful suggestions
- **Examples**: `if (retries < 3)` → `MAX_RETRIES`, `while (age < 18)` → `MAX_AGE`

### **2. Direct Apply Buttons**
- **🔥 One-Click Application**: Click on any constant with suggestions to apply the best one
- **💡 Individual Suggestions**: Apply specific suggestions from the dropdown
- **📊 Confidence Indicators**: Visual feedback on suggestion quality

### **3. Smart Context Analysis**
- **Time-related**: Detects time calculations and suggests appropriate names
- **Network-related**: Identifies port numbers and connection settings
- **UI-related**: Recognizes window dimensions and UI elements
- **Error codes**: Maps common HTTP and status codes

## 📁 **Test Files**

### `test/ConstantsDemo.java`
Contains various Java constants demonstrating different suggestion categories:

```java
// Magic numbers that should get suggestions
static final int MAGIC_42 = 42;        // → MAX_RETRIES, RETRY_COUNT
static final int MAGIC_1024 = 1024;    // → DEFAULT_BUFFER_SIZE, BUFFER_CAPACITY
static final int MAGIC_8080 = 8080;    // → ALTERNATIVE_HTTP_PORT, DEV_PORT
static final int MAGIC_5000 = 5000;    // → DEFAULT_TIMEOUT_MS, CONNECTION_TIMEOUT_MS

// Time-related constants
static final int MAGIC_1000 = 1000;    // → MILLISECONDS_PER_SECOND, MS_PER_SECOND
static final int MAGIC_3600 = 3600;    // → SECONDS_PER_HOUR, HOUR_IN_SECONDS

// UI-related constants
static final int MAGIC_800 = 800;      // → DEFAULT_WINDOW_WIDTH, MIN_WINDOW_WIDTH
static final int MAGIC_600 = 600;      // → DEFAULT_WINDOW_HEIGHT, MIN_WINDOW_HEIGHT

// Error codes
static final int MAGIC_404 = 404;      // → NOT_FOUND_ERROR, RESOURCE_NOT_FOUND
static final int MAGIC_500 = 500;      // → INTERNAL_ERROR, SERVER_ERROR
```

### `test/ConstantsDemo.cpp`
Contains C++ constants with similar patterns:

```cpp
// Magic numbers that should get suggestions
#define MAGIC_42 42        // → MAX_RETRIES, RETRY_COUNT
#define MAGIC_1024 1024    // → DEFAULT_BUFFER_SIZE, BUFFER_CAPACITY
#define MAGIC_8080 8080    // → ALTERNATIVE_HTTP_PORT, DEV_PORT

// Network ports
int httpPort = 80;         // → HTTP_PORT, DEFAULT_HTTP_PORT
int httpsPort = 443;       // → HTTPS_PORT, SECURE_HTTP_PORT

// Mathematical constants
double pi = 3.14159;       // → PI_VALUE, MATH_PI
double e = 2.718;          // → EULER_NUMBER, MATH_E
```

## 🎯 **How to Use**

### **1. View Constants**
1. Open the "Dependency Visualizer" panel in VS Code
2. Navigate to the "Constants" section
3. View all constants with their suggestions

### **2. Copy Suggestions** 📋 UPDATED
- **📋 Click on any constant** with suggestions to copy the best one to clipboard
- **💡 Expand suggestions** to see all alternatives
- **📋 Click individual suggestions** to copy specific ones to clipboard

### **3. Confidence Levels**
- **🔥 High Confidence (80%+)**: Strong suggestions based on clear patterns
- **💡 Medium Confidence (60-79%)**: Good suggestions with some context
- **💭 Low Confidence (40-59%)**: Basic suggestions for general cases

## 🎨 **Visual Features**

### **Constant Items**
- **Green icons**: Well-named constants (no suggestions needed)
- **Orange icons**: Constants with high-confidence suggestions
- **Yellow icons**: Constants with medium-confidence suggestions
- **Description shows**: Confidence percentage and suggestion count

### **Suggestion Items**
- **⭐ Primary suggestions**: Best recommendations
- **💡 Alternative suggestions**: Other good options
- **📋 Copy buttons**: Click to copy name to clipboard

### **Hover Information**
- **Rich tooltips** with detailed information
- **Copy buttons** for each suggestion
- **Context information** about the constant

## 📊 **Logging** ✨ NEW

The extension logs all constant naming actions to the "Constants Naming Log" output channel:
- **View logs**: Open Output panel (Ctrl+Shift+U) → Select "Constants Naming Log"
- **Logged actions**: Copy to clipboard, Apply suggestion
- **Format**: `[timestamp] ACTION: "value" → "suggestion" at file:line`

## 🔧 **Naming Rule Categories**

### **1. Magic Number Detection (95% confidence)**
- Identifies numbers ≥ 2 digits that aren't common constants
- Provides context-specific suggestions based on usage

### **2. Time Constants (90% confidence)**
- **1000**: `MILLISECONDS_PER_SECOND`, `MS_PER_SECOND`
- **60**: `SECONDS_PER_MINUTE`, `MINUTES_PER_HOUR`
- **3600**: `SECONDS_PER_HOUR`, `HOUR_IN_SECONDS`
- **86400**: `SECONDS_PER_DAY`, `DAY_IN_SECONDS`

### **3. Buffer & Size Constants (85% confidence)**
- **1024**: `DEFAULT_BUFFER_SIZE`, `BUFFER_CAPACITY`, `KILOBYTE_SIZE`
- **2048**: `LARGE_BUFFER_SIZE`, `WRITE_BUFFER_SIZE`
- **4096**: `PAGE_SIZE`, `MAX_BUFFER_SIZE`
- **65536**: `MAX_BUFFER_SIZE`, `LARGE_CHUNK_SIZE`

### **4. Network Constants (88% confidence)**
- **80**: `HTTP_PORT`, `DEFAULT_HTTP_PORT`
- **443**: `HTTPS_PORT`, `SECURE_HTTP_PORT`
- **8080**: `ALTERNATIVE_HTTP_PORT`, `DEV_PORT`
- **3000**: `DEV_SERVER_PORT`, `NODE_PORT`
- **5432**: `POSTGRES_PORT`, `DATABASE_PORT`
- **3306**: `MYSQL_PORT`, `DATABASE_PORT`

### **5. UI Constants (82% confidence)**
- **800**: `DEFAULT_WINDOW_WIDTH`, `MIN_WINDOW_WIDTH`
- **600**: `DEFAULT_WINDOW_HEIGHT`, `MIN_WINDOW_HEIGHT`
- **1024**: `LARGE_WINDOW_WIDTH`, `HD_WIDTH`
- **768**: `LARGE_WINDOW_HEIGHT`, `HD_HEIGHT`

### **6. Error Constants (85% confidence)**
- **0**: `SUCCESS_CODE`, `OK_STATUS`
- **1**: `ERROR_CODE`, `FAILURE_STATUS`
- **404**: `NOT_FOUND_ERROR`, `RESOURCE_NOT_FOUND`
- **500**: `INTERNAL_ERROR`, `SERVER_ERROR`

### **7. Mathematical Constants (90% confidence)**
- **3.14159**: `PI_VALUE`, `MATH_PI`
- **2.718**: `EULER_NUMBER`, `MATH_E`

### **8. Cryptography Constants (88% confidence)** ✨ NEW
- **128**: `AES_KEY_SIZE_128`, `KEY_LENGTH_128`
- **256**: `AES_KEY_SIZE_256`, `SHA256_BITS`
- **2048**: `RSA_KEY_SIZE_2048`, `RECOMMENDED_KEY_SIZE`
- **4096**: `RSA_KEY_SIZE_4096`, `HIGH_SECURITY_KEY_SIZE`

### **9. Unix Permission Constants (92% confidence)** ✨ NEW
- **755**: `DIR_PERMISSION_755`, `EXECUTABLE_PERMISSION`
- **644**: `FILE_PERMISSION_644`, `READ_WRITE_PERMISSION`
- **700**: `OWNER_ONLY_PERMISSION`, `PRIVATE_DIR_MODE`
- **777**: `FULL_PERMISSION_777`, `ALL_ACCESS_PERMISSION`

### **10. Retry Limits (85% confidence)** ✨ NEW
- Detects small integers (1-20) near retry/poll/attempt keywords
- Suggestions: `MAX_RETRIES`, `RETRY_LIMIT`, `MAX_POLL_ATTEMPTS`

### **11. Character Codes (80% confidence)** ✨ NEW
- **32**: `SPACE_CHAR`, `SPACE_ASCII`
- **10**: `NEWLINE_CHAR`, `LINE_FEED`
- **13**: `CARRIAGE_RETURN`, `CR_CHAR`
- **9**: `TAB_CHAR`, `HORIZONTAL_TAB`

### **12. Bit Flag Constants (90% confidence)** ✨ NEW
- Power-of-2 values near bitwise operations (&, |, ^, <<, >>)
- Suggestions: `FLAG_BIT_N`, `MASK_N`, `BIT_FLAG_N`

### **13. Memory/Alignment Constants (82% confidence)** ✨ NEW
- **64**: `CACHE_LINE_SIZE_64`, `BLOCK_SIZE_64`
- **128**: `BLOCK_SIZE_128`, `CACHE_BLOCK_SIZE`
- **256**: `PAGE_SIZE_256`, `ALLOCATION_BLOCK`

### **14. Configuration Thresholds (75% confidence)** ✨ NEW
- **50**: `HALF_PERCENT`, `MID_THRESHOLD`
- **100**: `FULL_PERCENT`, `MAX_PERCENTAGE`
- **1000**: `THOUSAND_VALUE`, `KILO_MULTIPLIER`

## 🚀 **Benefits**

### **For Developers**
- **Faster refactoring**: One-click constant renaming
- **Better code quality**: Consistent naming conventions
- **Reduced errors**: Context-aware suggestions
- **Learning tool**: Understand naming patterns

### **For Teams**
- **Consistent standards**: Enforced naming conventions
- **Code reviews**: Easier to spot magic numbers
- **Maintenance**: Better code readability
- **Onboarding**: New developers learn patterns quickly

## 📊 **Statistics**

The extension provides detailed statistics:
- **Total constants** found in the workspace
- **Constants with suggestions** (improvement opportunities)
- **High-confidence suggestions** (strong recommendations)
- **Files analyzed** for constants

## 🎯 **Best Practices**

1. **Review suggestions** before applying
2. **Consider context** when choosing names
3. **Use high-confidence suggestions** when possible
4. **Customize naming rules** for your project
5. **Regular analysis** to maintain code quality

## 🔄 **Auto-Refresh**

The extension automatically:
- **Scans for changes** in Java and C++ files
- **Updates suggestions** when code changes
- **Refreshes the view** to show new constants
- **Maintains accuracy** of suggestions

This improved constant naming feature makes it easier than ever to maintain clean, well-named code across your entire project! 🎉 