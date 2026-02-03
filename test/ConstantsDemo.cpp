#include <iostream>

// Magic numbers that should get suggestions
 // Should suggest INTERNAL_ERROR, SERVER_ERROR, etc.

// Well-named constants (should not get suggestions)
const int MAX_CONNECTIONS = 100;
const int DEFAULT_TIMEOUT_MS = 30000;
const char* API_BASE_URL = "https://api.example.com";

class ConstantsDemo {
public:
    void processData() {
        // Magic numbers in context
        int bufferSize = 2048;  // Should suggest LARGE_BUFFER_SIZE, WRITE_BUFFER_SIZE, etc.
        int timeout = 5000;     // Should suggest DEFAULT_TIMEOUT_MS, CONNECTION_TIMEOUT_MS, etc.
        int port = 3000;        // Should suggest DEV_SERVER_PORT, NODE_PORT, etc.
        
        // Time calculations
        int secondsInDay = 86400;  // Should suggest SECONDS_PER_DAY, DAY_IN_SECONDS, etc.
        int minutesInHour = 60;    // Should suggest SECONDS_PER_MINUTE, MINUTES_PER_HOUR, etc.
        
        // UI dimensions
        int windowWidth = 1024;    // Should suggest LARGE_WINDOW_WIDTH, HD_WIDTH, etc.
        int windowHeight = 768;    // Should suggest LARGE_WINDOW_HEIGHT, HD_HEIGHT, etc.
        
        // Network operations
        int httpPort = 80;         // Should suggest HTTP_PORT, DEFAULT_HTTP_PORT, etc.
        int httpsPort = 443;       // Should suggest HTTPS_PORT, SECURE_HTTP_PORT, etc.
        
        // Mathematical constants
        double pi = 3.14159;       // Should suggest PI_VALUE, MATH_PI, etc.
        double e = 2.718;          // Should suggest EULER_NUMBER, MATH_E, etc.
    }
};


// NEW: Retry limit test cases
void connectWithRetry() {
    int maxRetries = 3;           // Should suggest MAX_RETRIES, RETRY_LIMIT
    int pollAttempts = 5;         // Should suggest MAX_POLL_ATTEMPTS, POLL_RETRY_LIMIT
}

     // Should suggest CARRIAGE_RETURN, CR_CHAR

// NEW: Bit flag test cases
void checkFlags() {
    int flag1 = 1;                // Bit flag for enabled
    int flag2 = 2;                // Bit flag for active  
    int flag4 = 4;                // Bit flag for visible
    int combined = flag1 | flag2; // Bitwise OR
}

       // Should suggest HALF_PERCENT, MID_THRESHOLD 