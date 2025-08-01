import { Dependency } from './dependencyAnalyzer';

export class ConflictDetector {
    detectConflicts(dependencies: Dependency[]): Map<string, string[]> {
        const conflicts = new Map<string, string[]>();
        const versionMap = new Map<string, Set<string>>();

        // Group dependencies by name and collect versions
        for (const dep of dependencies) {
            if (!versionMap.has(dep.name)) {
                versionMap.set(dep.name, new Set());
            }
            versionMap.get(dep.name)!.add(dep.version);
        }

        // Find conflicts (multiple versions of same library)
        versionMap.forEach((versions, libName) => {
            if (versions.size > 1) {
                conflicts.set(libName, Array.from(versions));
            }
        });

        return conflicts;
    }

    resolveConflict(libName: string, versions: string[]): string {
        // Simple resolution: choose the highest version
        return versions.sort((a, b) => this.compareVersions(b, a))[0];
    }

    private compareVersions(a: string, b: string): number {
        const aParts = a.split('.').map(Number);
        const bParts = b.split('.').map(Number);
        
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
            const aPart = aParts[i] || 0;
            const bPart = bParts[i] || 0;
            
            if (aPart > bPart) return 1;
            if (aPart < bPart) return -1;
        }
        
        return 0;
    }
}
