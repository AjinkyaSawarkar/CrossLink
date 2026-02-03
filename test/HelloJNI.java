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



    
    public static void main(String[] args) {
        HelloJNI hello = new HelloJNI();
        hello.sayHello();  // Calls the native method
        int result = hello.add(5, 3);
        String message = hello.getMessage("World");
        System.out.println("Result: " + result);
        System.out.println("Message: " + message);

        if(result<8080){};
    }
} 