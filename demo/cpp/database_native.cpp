// Demo C++ file for Heat Map testing - Bridge component with JNI integration
#include <jni.h>
#include <string>
#include <vector>
#include <memory>
#include <iostream>
#include <fstream>
#include <sstream>
#include <chrono>
#include <thread>
#include <mutex>
#include <unordered_map>
#include <algorithm>
#include <cstring>
#include <openssl/evp.h>
#include <openssl/aes.h>
#include <openssl/rand.h>
#include <sqlite3.h>
#include <boost/algorithm/string.hpp>
#include <boost/serialization/vector.hpp>

// JNI method implementations for DatabaseManager
extern "C" {

/**
 * Native connection manager - demonstrates high coupling with multiple dependencies
 * This file shows cross-language bridge pattern with high heat score
 */
class NativeConnectionManager {
private:
    sqlite3* db;
    std::mutex connectionMutex;
    std::unordered_map<std::string, std::string> connectionCache;
    std::vector<std::string> queryHistory;
    bool isConnected;
    std::string currentConnectionString;
    
    // Encryption context
    EVP_CIPHER_CTX* encryptCtx;
    EVP_CIPHER_CTX* decryptCtx;
    unsigned char key[32];
    unsigned char iv[16];
    
public:
    NativeConnectionManager() : db(nullptr), isConnected(false), encryptCtx(nullptr), decryptCtx(nullptr) {
        // Initialize OpenSSL
        EVP_add_cipher(EVP_aes_256_cbc());
        encryptCtx = EVP_CIPHER_CTX_new();
        decryptCtx = EVP_CIPHER_CTX_new();
        
        // Generate random key and IV
        RAND_bytes(key, sizeof(key));
        RAND_bytes(iv, sizeof(iv));
    }
    
    ~NativeConnectionManager() {
        if (db) {
            sqlite3_close(db);
        }
        if (encryptCtx) EVP_CIPHER_CTX_free(encryptCtx);
        if (decryptCtx) EVP_CIPHER_CTX_free(decryptCtx);
    }
    
    bool initializeConnection(const std::string& connectionString) {
        std::lock_guard<std::mutex> lock(connectionMutex);
        
        try {
            // Parse connection string
            auto params = parseConnectionString(connectionString);
            
            // Open SQLite database
            int rc = sqlite3_open(params["database"].c_str(), &db);
            if (rc != SQLITE_OK) {
                std::cerr << "Cannot open database: " << sqlite3_errmsg(db) << std::endl;
                return false;
            }
            
            // Configure database
            configurePragmas();
            
            // Cache connection info
            connectionCache["last_connection"] = connectionString;
            connectionCache["connection_time"] = std::to_string(
                std::chrono::duration_cast<std::chrono::seconds>(
                    std::chrono::system_clock::now().time_since_epoch()
                ).count()
            );
            
            currentConnectionString = connectionString;
            isConnected = true;
            
            std::cout << "[NATIVE] Database connection initialized: " << params["database"] << std::endl;
            return true;
            
        } catch (const std::exception& e) {
            std::cerr << "[NATIVE] Connection failed: " << e.what() << std::endl;
            return false;
        }
    }
    
    int executeQuery(const std::string& query, const std::vector<unsigned char>& params) {
        std::lock_guard<std::mutex> lock(connectionMutex);
        
        if (!isConnected || !db) {
            std::cerr << "[NATIVE] Database not connected" << std::endl;
            return -1;
        }
        
        try {
            // Log query for analysis
            queryHistory.push_back(query);
            if (queryHistory.size() > 1000) {
                queryHistory.erase(queryHistory.begin());
            }
            
            // Prepare statement
            sqlite3_stmt* stmt;
            int rc = sqlite3_prepare_v2(db, query.c_str(), -1, &stmt, nullptr);
            if (rc != SQLITE_OK) {
                std::cerr << "[NATIVE] Query preparation failed: " << sqlite3_errmsg(db) << std::endl;
                return -1;
            }
            
            // Bind parameters (simplified for demo)
            if (!params.empty()) {
                bindParameters(stmt, params);
            }
            
            // Execute query
            int rowCount = 0;
            while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
                rowCount++;
                // Process row data
                processRowData(stmt);
            }
            
            if (rc != SQLITE_DONE) {
                std::cerr << "[NATIVE] Query execution failed: " << sqlite3_errmsg(db) << std::endl;
                sqlite3_finalize(stmt);
                return -1;
            }
            
            sqlite3_finalize(stmt);
            
            std::cout << "[NATIVE] Query executed successfully, rows affected: " << rowCount << std::endl;
            return rowCount;
            
        } catch (const std::exception& e) {
            std::cerr << "[NATIVE] Query execution error: " << e.what() << std::endl;
            return -1;
        }
    }
    
    std::vector<unsigned char> encryptData(const std::vector<unsigned char>& data, const std::string& keyStr) {
        std::lock_guard<std::mutex> lock(connectionMutex);
        
        try {
            // Initialize encryption
            if (EVP_EncryptInit_ex(encryptCtx, EVP_aes_256_cbc(), nullptr, key, iv) != 1) {
                throw std::runtime_error("Encryption initialization failed");
            }
            
            std::vector<unsigned char> encrypted;
            encrypted.resize(data.size() + AES_BLOCK_SIZE);
            
            int len;
            int encryptedLen = 0;
            
            // Encrypt data
            if (EVP_EncryptUpdate(encryptCtx, encrypted.data(), &len, data.data(), data.size()) != 1) {
                throw std::runtime_error("Encryption update failed");
            }
            encryptedLen = len;
            
            // Finalize encryption
            if (EVP_EncryptFinal_ex(encryptCtx, encrypted.data() + len, &len) != 1) {
                throw std::runtime_error("Encryption finalization failed");
            }
            encryptedLen += len;
            
            encrypted.resize(encryptedLen);
            return encrypted;
            
        } catch (const std::exception& e) {
            std::cerr << "[NATIVE] Encryption error: " << e.what() << std::endl;
            return data; // Return original data on error
        }
    }
    
    std::vector<unsigned char> decryptData(const std::vector<unsigned char>& encryptedData, const std::string& keyStr) {
        std::lock_guard<std::mutex> lock(connectionMutex);
        
        try {
            // Initialize decryption
            if (EVP_DecryptInit_ex(decryptCtx, EVP_aes_256_cbc(), nullptr, key, iv) != 1) {
                throw std::runtime_error("Decryption initialization failed");
            }
            
            std::vector<unsigned char> decrypted;
            decrypted.resize(encryptedData.size());
            
            int len;
            int decryptedLen = 0;
            
            // Decrypt data
            if (EVP_DecryptUpdate(decryptCtx, decrypted.data(), &len, encryptedData.data(), encryptedData.size()) != 1) {
                throw std::runtime_error("Decryption update failed");
            }
            decryptedLen = len;
            
            // Finalize decryption
            if (EVP_DecryptFinal_ex(decryptCtx, decrypted.data() + len, &len) != 1) {
                throw std::runtime_error("Decryption finalization failed");
            }
            decryptedLen += len;
            
            decrypted.resize(decryptedLen);
            return decrypted;
            
        } catch (const std::exception& e) {
            std::cerr << "[NATIVE] Decryption error: " << e.what() << std::endl;
            return encryptedData; // Return encrypted data on error
        }
    }
    
    void closeConnection() {
        std::lock_guard<std::mutex> lock(connectionMutex);
        
        if (db) {
            sqlite3_close(db);
            db = nullptr;
        }
        
        isConnected = false;
        connectionCache.clear();
        queryHistory.clear();
        
        std::cout << "[NATIVE] Database connection closed" << std::endl;
    }
    
private:
    std::unordered_map<std::string, std::string> parseConnectionString(const std::string& connStr) {
        std::unordered_map<std::string, std::string> params;
        
        // Simple parsing for demo (normally would be more robust)
        std::vector<std::string> pairs;
        boost::split(pairs, connStr, boost::is_any_of(";"));
        
        for (const auto& pair : pairs) {
            std::vector<std::string> keyValue;
            boost::split(keyValue, pair, boost::is_any_of("="));
            if (keyValue.size() == 2) {
                params[keyValue[0]] = keyValue[1];
            }
        }
        
        // Default values
        if (params.find("database") == params.end()) {
            params["database"] = ":memory:";
        }
        
        return params;
    }
    
    void configurePragmas() {
        // Configure SQLite for performance
        sqlite3_exec(db, "PRAGMA journal_mode=WAL;", nullptr, nullptr, nullptr);
        sqlite3_exec(db, "PRAGMA synchronous=NORMAL;", nullptr, nullptr, nullptr);
        sqlite3_exec(db, "PRAGMA cache_size=10000;", nullptr, nullptr, nullptr);
        sqlite3_exec(db, "PRAGMA temp_store=MEMORY;", nullptr, nullptr, nullptr);
    }
    
    void bindParameters(sqlite3_stmt* stmt, const std::vector<unsigned char>& params) {
        // Simplified parameter binding for demo
        // In real implementation, would deserialize and bind properly
        if (!params.empty()) {
            sqlite3_bind_blob(stmt, 1, params.data(), params.size(), SQLITE_STATIC);
        }
    }
    
    void processRowData(sqlite3_stmt* stmt) {
        int columnCount = sqlite3_column_count(stmt);
        for (int i = 0; i < columnCount; i++) {
            const char* columnName = sqlite3_column_name(stmt, i);
            int columnType = sqlite3_column_type(stmt, i);
            
            // Process different column types
            switch (columnType) {
                case SQLITE_INTEGER:
                    sqlite3_column_int64(stmt, i);
                    break;
                case SQLITE_FLOAT:
                    sqlite3_column_double(stmt, i);
                    break;
                case SQLITE_TEXT:
                    sqlite3_column_text(stmt, i);
                    break;
                case SQLITE_BLOB:
                    sqlite3_column_blob(stmt, i);
                    break;
                default:
                    break;
            }
        }
    }
};

// Global connection manager instance
static std::unique_ptr<NativeConnectionManager> g_connectionManager;

// JNI method implementations
JNIEXPORT void JNICALL
Java_com_example_demo_DatabaseManager_initializeNativeConnection(JNIEnv *env, jobject thiz, jstring connectionString) {
    const char* connStr = env->GetStringUTFChars(connectionString, nullptr);
    
    if (!g_connectionManager) {
        g_connectionManager = std::make_unique<NativeConnectionManager>();
    }
    
    bool success = g_connectionManager->initializeConnection(std::string(connStr));
    
    env->ReleaseStringUTFChars(connectionString, connStr);
    
    if (!success) {
        jclass exceptionClass = env->FindClass("java/sql/SQLException");
        env->ThrowNew(exceptionClass, "Failed to initialize native connection");
    }
}

JNIEXPORT jint JNICALL
Java_com_example_demo_DatabaseManager_executeNativeQuery(JNIEnv *env, jobject thiz, jstring query, jbyteArray params) {
    if (!g_connectionManager) {
        return -1;
    }
    
    const char* queryStr = env->GetStringUTFChars(query, nullptr);
    
    std::vector<unsigned char> paramVector;
    if (params != nullptr) {
        jsize paramLength = env->GetArrayLength(params);
        jbyte* paramBytes = env->GetByteArrayElements(params, nullptr);
        
        paramVector.resize(paramLength);
        std::memcpy(paramVector.data(), paramBytes, paramLength);
        
        env->ReleaseByteArrayElements(params, paramBytes, JNI_ABORT);
    }
    
    int result = g_connectionManager->executeQuery(std::string(queryStr), paramVector);
    
    env->ReleaseStringUTFChars(query, queryStr);
    
    return result;
}

JNIEXPORT void JNICALL
Java_com_example_demo_DatabaseManager_closeNativeConnection(JNIEnv *env, jobject thiz) {
    if (g_connectionManager) {
        g_connectionManager->closeConnection();
        g_connectionManager.reset();
    }
}

JNIEXPORT jbyteArray JNICALL
Java_com_example_demo_DatabaseManager_encryptData(JNIEnv *env, jobject thiz, jbyteArray data, jstring key) {
    if (!g_connectionManager) {
        return nullptr;
    }
    
    const char* keyStr = env->GetStringUTFChars(key, nullptr);
    
    jsize dataLength = env->GetArrayLength(data);
    jbyte* dataBytes = env->GetByteArrayElements(data, nullptr);
    
    std::vector<unsigned char> dataVector(dataBytes, dataBytes + dataLength);
    std::vector<unsigned char> encrypted = g_connectionManager->encryptData(dataVector, std::string(keyStr));
    
    jbyteArray result = env->NewByteArray(encrypted.size());
    env->SetByteArrayRegion(result, 0, encrypted.size(), reinterpret_cast<const jbyte*>(encrypted.data()));
    
    env->ReleaseByteArrayElements(data, dataBytes, JNI_ABORT);
    env->ReleaseStringUTFChars(key, keyStr);
    
    return result;
}

JNIEXPORT jbyteArray JNICALL
Java_com_example_demo_DatabaseManager_decryptData(JNIEnv *env, jobject thiz, jbyteArray encryptedData, jstring key) {
    if (!g_connectionManager) {
        return nullptr;
    }
    
    const char* keyStr = env->GetStringUTFChars(key, nullptr);
    
    jsize dataLength = env->GetArrayLength(encryptedData);
    jbyte* dataBytes = env->GetByteArrayElements(encryptedData, nullptr);
    
    std::vector<unsigned char> encryptedVector(dataBytes, dataBytes + dataLength);
    std::vector<unsigned char> decrypted = g_connectionManager->decryptData(encryptedVector, std::string(keyStr));
    
    jbyteArray result = env->NewByteArray(decrypted.size());
    env->SetByteArrayRegion(result, 0, decrypted.size(), reinterpret_cast<const jbyte*>(decrypted.data()));
    
    env->ReleaseByteArrayElements(encryptedData, dataBytes, JNI_ABORT);
    env->ReleaseStringUTFChars(key, keyStr);
    
    return result;
}

} // extern "C"
