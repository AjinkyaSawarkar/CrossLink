import { Dependency } from './dependencyAnalyzer';
import * as os from 'os';

export class PlatformChecker {
    private currentPlatform = os.platform();

    checkCompatibility(dependencies: Dependency[]): string[] {
        const incompatible: string[] = [];

        for (const dep of dependencies) {
            if (!this.isCompatible(dep)) {
                incompatible.push(dep.name);
            }
        }

        return incompatible;
    }

    private isCompatible(dependency: Dependency): boolean {
        const platform = this.currentPlatform;
        
        switch (dependency.type) {
            case 'dll':
                return platform === 'win32';
            case 'so':
                return platform === 'linux';
            case 'dylib':
                return platform === 'darwin';
            case 'jar':
                return true; // Java is cross-platform
            default:
                return true;
        }
    }

    getPlatformExtension(): string {
        switch (this.currentPlatform) {
            case 'win32':
                return 'dll';
            case 'linux':
                return 'so';
            case 'darwin':
                return 'dylib';
            default:
                return 'so';
        }
    }

    getSupportedPlatforms(dependency: Dependency): string[] {
        switch (dependency.type) {
            case 'dll':
                return ['Windows'];
            case 'so':
                return ['Linux'];
            case 'dylib':
                return ['macOS'];
            case 'jar':
                return ['Windows', 'Linux', 'macOS'];
            default:
                return ['Unknown'];
        }
    }
}
