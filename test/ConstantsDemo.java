public class ConstantsDemo {
    // Magic numbers that should get suggestions
    static final int balu = 42;  // Should suggest MAX_RETRIES, RETRY_COUNT, etc.
    static final int shubham = 1024;  // Should suggest DEFAULT_BUFFER_SIZE, BUFFER_CAPACITY, etc.
    static final int Ajinkya = 8080;  // Should suggest ALTERNATIVE_HTTP_PORT, DEV_PORT, etc.
    static final int aj5000 = 5000;  // Should suggest DEFAULT_TIMEOUT_MS, CONNECTION_TIMEOUT_MS, etc.
    
    // Time-related constants
    static final int aj1000 = 1000;  // Should suggest MILLISECONDS_PER_SECOND, MS_PER_SECOND, etc.
    static final int aj3600 = 3600;  // Should suggest SECONDS_PER_HOUR, HOUR_IN_SECONDS, etc.
    
    // UI-related constants
    static final int aj800 = 800;  // Should suggest DEFAULT_WINDOW_WIDTH, MIN_WINDOW_WIDTH, etc.
    static final int aj600 = 600;  // Should suggest DEFAULT_WINDOW_HEIGHT, MIN_WINDOW_HEIGHT, etc.
    
    // Error codes
    static final int aj404 = 404;  // Should suggest NOT_FOUND_ERROR, RESOURCE_NOT_FOUND, etc.
    static final int aj500 = 500;  // Should suggest INTERNAL_ERROR, SERVER_ERROR, etc.
    
    // Well-named constants (should not get suggestions)
    static final int MAX_CONNECTIONS = 100;
    static final int DEFAULT_TIMEOUT_MS = 30000;
    static final String API_BASE_URL = "https://api.example.com";
    
    public void processData() {
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
    }
    
    // NEW: Cryptography constants test cases
    
    public void connectWithRetry() {
        int maxRetries = 3;                    // Should suggest MAX_RETRIES, RETRY_LIMIT
        int pollAttempts = 5;                  // Should suggest MAX_POLL_ATTEMPTS, POLL_RETRY_LIMIT
    }
          // Should suggest NEWLINE_CHAR, LINE_FEED
    
    // NEW: Bit flag test cases
    public void checkFlags() {
        int flag1 = 1;                         // Bit flag for enabled
        int flag2 = 2;                         // Bit flag for active
        int flag4 = 4;                         // Bit flag for visible
        int combined = flag1 | flag2;          // Bitwise OR
    }
    
    // NEW: Configuration threshold test cases
    static final int THRESHOLD = 100;          // Should suggest FULL_PERCENT, MAX_PERCENTAGE
    static final int HALF = 50;  
    int a = 500;   
    
    if(a<8080){};
        // Should suggest HALF_PERCENT, MID_THRESHOLD

        b = a * 1.18;
    
} 