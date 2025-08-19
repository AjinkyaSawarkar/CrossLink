#include <jni.h>
#include <iostream>
#include <string>

// Implementation of sayHello method
JNIEXPORT void JNICALL Java_HelloJNI_sayHello(JNIEnv *env, jobject obj) {
    std::cout << "Hello from C++ via JNI!" << std::endl;
}

// Implementation of add method
JNIEXPORT jint JNICALL Java_HelloJNI_add(JNIEnv *env, jobject obj, jint a, jint b) {
    return a + b;
}

// Note: getMessage method is NOT implemented - this should show as missing implementation 