// Demo Java file - Utility component with moderate coupling
package com.example.demo;

import java.io.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * ConfigLoader - A utility component with moderate heat score
 * Shows medium coupling with some dependencies but not as complex as DatabaseManager
 */
public class ConfigLoader {
    private static final String DEFAULT_CONFIG_PATH = "config.properties";
    private static ConfigLoader instance;
    private Map<String, String> properties;
    private long lastModified;
    private String configPath;
    
    private ConfigLoader(String configPath) {
        this.configPath = configPath;
        this.properties = new ConcurrentHashMap<>();
        loadProperties();
    }
    
    public static synchronized ConfigLoader getInstance() {
        if (instance == null) {
            instance = new ConfigLoader(DEFAULT_CONFIG_PATH);
        }
        return instance;
    }
    
    public static synchronized ConfigLoader getInstance(String configPath) {
        if (instance == null) {
            instance = new ConfigLoader(configPath);
        }
        return instance;
    }
    
    private void loadProperties() {
        File configFile = new File(configPath);
        
        if (!configFile.exists()) {
            createDefaultConfig(configFile);
        }
        
        try (FileInputStream fis = new FileInputStream(configFile)) {
            Properties props = new Properties();
            props.load(fis);
            
            // Convert to our internal map
            for (String key : props.stringPropertyNames()) {
                properties.put(key, props.getProperty(key));
            }
            
            lastModified = configFile.lastModified();
            System.out.println("Configuration loaded from: " + configPath);
            
        } catch (IOException e) {
            System.err.println("Failed to load configuration: " + e.getMessage());
            loadDefaultProperties();
        }
    }
    
    private void createDefaultConfig(File configFile) {
        try {
            configFile.getParentFile().mkdirs();
            
            try (FileWriter writer = new FileWriter(configFile)) {
                writer.write("# Default Configuration\n");
                writer.write("database.url=jdbc:sqlite:demo.db\n");
                writer.write("database.username=demo\n");
                writer.write("database.password=demo123\n");
                writer.write("cache.size=1000\n");
                writer.write("cache.ttl=300\n");
                writer.write("logging.level=INFO\n");
                writer.write("security.encryption.enabled=true\n");
                writer.write("performance.thread.pool.size=10\n");
            }
            
            System.out.println("Default configuration created: " + configPath);
            
        } catch (IOException e) {
            System.err.println("Failed to create default configuration: " + e.getMessage());
        }
    }
    
    private void loadDefaultProperties() {
        properties.clear();
        properties.put("database.url", "jdbc:sqlite::memory:");
        properties.put("database.username", "default");
        properties.put("database.password", "default");
        properties.put("cache.size", "500");
        properties.put("cache.ttl", "180");
        properties.put("logging.level", "WARN");
        properties.put("security.encryption.enabled", "false");
        properties.put("performance.thread.pool.size", "5");
    }
    
    public String getProperty(String key) {
        checkForUpdates();
        return properties.get(key);
    }
    
    public String getProperty(String key, String defaultValue) {
        String value = getProperty(key);
        return value != null ? value : defaultValue;
    }
    
    public int getIntProperty(String key, int defaultValue) {
        String value = getProperty(key);
        if (value != null) {
            try {
                return Integer.parseInt(value);
            } catch (NumberFormatException e) {
                System.err.println("Invalid integer value for " + key + ": " + value);
            }
        }
        return defaultValue;
    }
    
    public boolean getBooleanProperty(String key, boolean defaultValue) {
        String value = getProperty(key);
        if (value != null) {
            return Boolean.parseBoolean(value);
        }
        return defaultValue;
    }
    
    public void setProperty(String key, String value) {
        properties.put(key, value);
        saveProperties();
    }
    
    private void saveProperties() {
        try (FileWriter writer = new FileWriter(configPath)) {
            writer.write("# Configuration - Last updated: " + new Date() + "\n");
            
            for (Map.Entry<String, String> entry : properties.entrySet()) {
                writer.write(entry.getKey() + "=" + entry.getValue() + "\n");
            }
            
            System.out.println("Configuration saved to: " + configPath);
            
        } catch (IOException e) {
            System.err.println("Failed to save configuration: " + e.getMessage());
        }
    }
    
    private void checkForUpdates() {
        File configFile = new File(configPath);
        if (configFile.exists() && configFile.lastModified() > lastModified) {
            System.out.println("Configuration file updated, reloading...");
            loadProperties();
        }
    }
    
    public void reload() {
        loadProperties();
    }
    
    public Set<String> getKeys() {
        checkForUpdates();
        return new HashSet<>(properties.keySet());
    }
    
    public Map<String, String> getAllProperties() {
        checkForUpdates();
        return new HashMap<>(properties);
    }
    
    // Configuration validation
    public boolean validateConfiguration() {
        boolean valid = true;
        
        // Check required properties
        String[] requiredKeys = {
            "database.url",
            "database.username", 
            "database.password"
        };
        
        for (String key : requiredKeys) {
            if (!properties.containsKey(key) || properties.get(key).trim().isEmpty()) {
                System.err.println("Missing required configuration: " + key);
                valid = false;
            }
        }
        
        // Validate numeric properties
        try {
            int cacheSize = getIntProperty("cache.size", 0);
            if (cacheSize <= 0) {
                System.err.println("Invalid cache size: " + cacheSize);
                valid = false;
            }
            
            int threadPoolSize = getIntProperty("performance.thread.pool.size", 0);
            if (threadPoolSize <= 0) {
                System.err.println("Invalid thread pool size: " + threadPoolSize);
                valid = false;
            }
            
        } catch (Exception e) {
            System.err.println("Configuration validation error: " + e.getMessage());
            valid = false;
        }
        
        return valid;
    }
}
