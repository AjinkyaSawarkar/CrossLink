import { DependencyAnalyzer } from './dependencyAnalyzer';

let analyzerInstance: DependencyAnalyzer | null = null;

export function setAnalyzer(instance: DependencyAnalyzer) {
    analyzerInstance = instance;
}

export function getAnalyzer(): DependencyAnalyzer | null {
    return analyzerInstance;
}
