// Demo Java file for Heat Map testing - High coupling example
package com.example.demo;

import java.sql.*;
import java.util.*;
import java.io.*;
import java.net.*;
import java.util.concurrent.*;
import java.security.*;
import javax.crypto.*;
import java.text.*;
import java.time.*;

/**
 * DatabaseManager - A highly coupled core component that demonstrates
 * high heat score due to many dependencies and cross-language connections
 */
public class DatabaseManager {
    // Native method declarations for C++ integration
    public native void initializeNativeConnection(String connectionString);
    public native int executeNativeQuery(String query, byte[] params);
    public native void closeNativeConnection();
    public native byte[] encryptData(byte[] data, String key);
    public native byte[] decryptData(byte[] encryptedData, String key);
    
    // Multiple dependencies creating high coupling
    private Connection connection;
    private PreparedStatement statement;
    private ResultSet resultSet;
    private Properties config;
    private Logger logger;
    private CacheManager cacheManager;
    private SecurityManager securityManager;
    private ThreadPoolExecutor executor;
    private MessageDigest digest;
    private Cipher cipher;
    private DateFormat dateFormat;
    private TimeZone timeZone;
    
    // Static block loading native library
    static {
        System.loadLibrary("database_native");
    }
    
    public DatabaseManager() {
        this.config = new Properties();
        this.logger = new Logger();
        this.cacheManager = new CacheManager();
        this.securityManager = new SecurityManager();
        this.executor = new ThreadPoolExecutor(5, 10, 60L, TimeUnit.SECONDS, 
                                             new LinkedBlockingQueue<>());
        try {
            this.digest = MessageDigest.getInstance("SHA-256");
            this.cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        } catch (Exception e) {
            logger.error("Failed to initialize security components", e);
        }
    }
    
    public void connect(String url, String username, String password) {
        try {
            // High complexity method with multiple dependencies
            connection = DriverManager.getConnection(url, username, password);
            initializeNativeConnection(url);
            
            // Cache connection info
            cacheManager.put("connection_url", url);
            cacheManager.put("connection_time", System.currentTimeMillis());
            
            // Log connection
            logger.info("Database connected: " + url);
            
            // Security check
            if (!securityManager.validateConnection(url)) {
                throw new SecurityException("Connection not allowed");
            }
            
        } catch (SQLException e) {
            logger.error("Database connection failed", e);
            throw new RuntimeException("Connection failed", e);
        }
    }
    
    public List<Map<String, Object>> executeQuery(String query, Object... params) {
        List<Map<String, Object>> results = new ArrayList<>();
        
        try {
            // Check cache first
            String cacheKey = generateCacheKey(query, params);
            Object cached = cacheManager.get(cacheKey);
            if (cached != null) {
                return (List<Map<String, Object>>) cached;
            }
            
            // Prepare statement
            statement = connection.prepareStatement(query);
            
            // Set parameters
            for (int i = 0; i < params.length; i++) {
                statement.setObject(i + 1, params[i]);
            }
            
            // Execute native query for performance
            byte[] serializedParams = serializeParams(params);
            int nativeResult = executeNativeQuery(query, serializedParams);
            
            // Execute SQL query
            resultSet = statement.executeQuery();
            
            // Process results
            ResultSetMetaData metaData = resultSet.getMetaData();
            int columnCount = metaData.getColumnCount();
            
            while (resultSet.next()) {
                Map<String, Object> row = new HashMap<>();
                for (int i = 1; i <= columnCount; i++) {
                    String columnName = metaData.getColumnName(i);
                    Object value = resultSet.getObject(i);
                    
                    // Encrypt sensitive data
                    if (isSensitiveColumn(columnName)) {
                        value = encryptValue(value);
                    }
                    
                    row.put(columnName, value);
                }
                results.add(row);
            }
            
            // Cache results
            cacheManager.put(cacheKey, results, 300); // 5 minutes TTL
            
            // Log query execution
            logger.debug("Query executed: " + query + " returned " + results.size() + " rows");
            
        } catch (SQLException e) {
            logger.error("Query execution failed: " + query, e);
            throw new RuntimeException("Query failed", e);
        } finally {
            closeResources();
        }
        
        return results;
    }
    
    private String generateCacheKey(String query, Object... params) {
        StringBuilder keyBuilder = new StringBuilder(query);
        for (Object param : params) {
            keyBuilder.append(":").append(param);
        }
        
        // Hash the key for consistent length
        byte[] hash = digest.digest(keyBuilder.toString().getBytes());
        return Base64.getEncoder().encodeToString(hash);
    }
    
    private byte[] serializeParams(Object... params) {
        try {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ObjectOutputStream oos = new ObjectOutputStream(baos);
            oos.writeObject(params);
            return baos.toByteArray();
        } catch (IOException e) {
            logger.error("Failed to serialize parameters", e);
            return new byte[0];
        }
    }
    
    private boolean isSensitiveColumn(String columnName) {
        return columnName.toLowerCase().contains("password") ||
               columnName.toLowerCase().contains("ssn") ||
               columnName.toLowerCase().contains("credit");
    }
    
    private Object encryptValue(Object value) {
        if (value == null) return null;
        
        try {
            String stringValue = value.toString();
            byte[] encrypted = encryptData(stringValue.getBytes(), "default_key");
            return Base64.getEncoder().encodeToString(encrypted);
        } catch (Exception e) {
            logger.error("Failed to encrypt value", e);
            return value; // Return original if encryption fails
        }
    }
    
    private void closeResources() {
        try {
            if (resultSet != null) resultSet.close();
            if (statement != null) statement.close();
        } catch (SQLException e) {
            logger.error("Failed to close resources", e);
        }
    }
    
    public void disconnect() {
        try {
            closeNativeConnection();
            if (connection != null && !connection.isClosed()) {
                connection.close();
            }
            executor.shutdown();
            logger.info("Database disconnected");
        } catch (SQLException e) {
            logger.error("Error during disconnect", e);
        }
    }
    
    // Inner classes adding to complexity
    private static class Logger {
        public void info(String message) { System.out.println("[INFO] " + message); }
        public void debug(String message) { System.out.println("[DEBUG] " + message); }
        public void error(String message, Exception e) { 
            System.err.println("[ERROR] " + message + ": " + e.getMessage()); 
        }
    }
    
    private static class CacheManager {
        private Map<String, CacheEntry> cache = new ConcurrentHashMap<>();
        
        public void put(String key, Object value) { 
            cache.put(key, new CacheEntry(value, System.currentTimeMillis() + 300000)); 
        }
        
        public void put(String key, Object value, int ttlSeconds) { 
            cache.put(key, new CacheEntry(value, System.currentTimeMillis() + ttlSeconds * 1000)); 
        }
        
        public Object get(String key) { 
            CacheEntry entry = cache.get(key);
            if (entry != null && entry.expiryTime > System.currentTimeMillis()) {
                return entry.value;
            }
            cache.remove(key);
            return null;
        }
        
        private static class CacheEntry {
            Object value;
            long expiryTime;
            CacheEntry(Object value, long expiryTime) {
                this.value = value;
                this.expiryTime = expiryTime;
            }
        }
    }
    
    private static class SecurityManager {
        public boolean validateConnection(String url) {
            // Simple validation logic
            return url != null && !url.contains("localhost");
        }
    }
}
