public class ConstantsDemo {
    // Magic numbers that should get suggestions
    static final int MAGIC_42 = 42;  // Should suggest MAX_RETRIES, RETRY_COUNT, etc.
    static final int MAGIC_1024 = 1024;  // Should suggest DEFAULT_BUFFER_SIZE, BUFFER_CAPACITY, etc.
    static final int MAGIC_8080 = 8080;  // Should suggest ALTERNATIVE_HTTP_PORT, DEV_PORT, etc.
    static final int MAGIC_5000 = 5000;  // Should suggest DEFAULT_TIMEOUT_MS, CONNECTION_TIMEOUT_MS, etc.
    
    // Time-related constants
    static final int MAGIC_1000 = 1000;  // Should suggest MILLISECONDS_PER_SECOND, MS_PER_SECOND, etc.
    static final int MAGIC_3600 = 3600;  // Should suggest SECONDS_PER_HOUR, HOUR_IN_SECONDS, etc.
    
    // UI-related constants
    static final int MAGIC_800 = 800;  // Should suggest DEFAULT_WINDOW_WIDTH, MIN_WINDOW_WIDTH, etc.
    static final int MAGIC_600 = 600;  // Should suggest DEFAULT_WINDOW_HEIGHT, MIN_WINDOW_HEIGHT, etc.
    
    // Error codes
    static final int MAGIC_404 = 404;  // Should suggest NOT_FOUND_ERROR, RESOURCE_NOT_FOUND, etc.
    static final int MAGIC_500 = 500;  // Should suggest INTERNAL_ERROR, SERVER_ERROR, etc.
    
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
} 