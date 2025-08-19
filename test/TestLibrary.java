public class TestLibrary {
    
    static {
        // This should be highlighted based on whether calculator.dll/so/dylib exists
        System.loadLibrary("calculator");
        
        // This should be highlighted based on whether mathlib.dll/so/dylib exists
        System.loadLibrary("mathlib");
        
        // This should be highlighted based on whether graphics.dll/so/dylib exists
        System.loadLibrary("graphics");
    }
    
    // Native method declarations
    public native int add(int a, int b);
    public native double multiply(double x, double y);
    public native void drawCircle(int x, int y, int radius);
    
    public static void main(String[] args) {
        TestLibrary lib = new TestLibrary();
        
        // Test the native methods
        int result = lib.add(5, 3);
        System.out.println("5 + 3 = " + result);
        
        double product = lib.multiply(4.5, 2.0);
        System.out.println("4.5 * 2.0 = " + product);
        
        lib.drawCircle(100, 100, 50);
    }
} 