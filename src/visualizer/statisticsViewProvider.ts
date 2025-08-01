// src/visualizer/statisticsViewProvider.ts
import * as vscode from 'vscode';
import { DependencyAnalyzer } from '../core/dependencyAnalyzer';

export class StatisticsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'connectionStatistics';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private analyzer: DependencyAnalyzer
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            allowScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Listen for messages from the webview
        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'refresh':
                    await this.updateStatistics();
                    break;
            }
        });

        // Initial load
        this.updateStatistics();
    }

    public async updateStatistics() {
        if (this._view) {
            const connections = await this.analyzer.getFileConnections();
            const stats = this.calculateDetailedStats(connections);
            this._view.webview.postMessage({ type: 'updateStats', data: stats });
        }
    }

    private calculateDetailedStats(connections: any[]) {
        const total = connections.length;
        const connected = connections.filter(c => c.isMatched).length;
        const missing = total - connected;
        const percentage = total > 0 ? Math.round((connected / total) * 100) : 0;
        
        const javaFiles = new Set(connections.map(c => c.javaFile)).size;
        const cppFiles = new Set(connections.filter(c => c.isMatched).map(c => c.cppFile)).size;
        
        const packages = new Set(connections.map(c => {
            const srcIndex = c.javaFile.indexOf('src/main/java/');
            if (srcIndex !== -1) {
                const packagePath = c.javaFile.substring(srcIndex + 'src/main/java/'.length);
                const lastSlash = packagePath.lastIndexOf('/');
                return lastSlash > 0 ? packagePath.substring(0, lastSlash).replace(/\//g, '.') : '';
            }
            return '';
        })).size;

        return {
            total,
            connected,
            missing,
            percentage,
            javaFiles,
            cppFiles,
            packages,
            connectionRate: percentage
        };
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Connection Statistics</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 10px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .stat-card {
            background: var(--vscode-editor-widget-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            padding: 12px;
            margin-bottom: 10px;
        }
        .stat-title {
            font-weight: bold;
            margin-bottom: 8px;
            color: var(--vscode-textLink-foreground);
        }
        .stat-value {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 4px;
        }
        .stat-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .progress-bar {
            width: 100%;
            height: 8px;
            background: var(--vscode-progressBar-background);
            border-radius: 4px;
            overflow: hidden;
            margin: 8px 0;
        }
        .progress-fill {
            height: 100%;
            background: var(--vscode-progressBar-foreground);
            transition: width 0.3s ease;
        }
        .success { color: var(--vscode-terminal-ansiGreen); }
        .warning { color: var(--vscode-terminal-ansiYellow); }
        .error { color: var(--vscode-terminal-ansiRed); }
        .refresh-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            width: 100%;
            margin-top: 10px;
        }
        .refresh-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
    </style>
</head>
<body>
    <div id="stats-container">
        <div class="stat-card">
            <div class="stat-title">📊 Overall Connection Rate</div>
            <div class="stat-value" id="percentage">0%</div>
            <div class="progress-bar">
                <div class="progress-fill" id="progress" style="width: 0%"></div>
            </div>
            <div class="stat-label" id="connection-summary">Loading...</div>
        </div>

        <div class="stat-card">
            <div class="stat-title">📋 Methods</div>
            <div class="stat-value success" id="connected">0</div>
            <div class="stat-label">Connected</div>
            <div class="stat-value error" id="missing">0</div>
            <div class="stat-label">Missing</div>
        </div>

        <div class="stat-card">
            <div class="stat-title">📁 Files</div>
            <div class="stat-value" id="java-files">0</div>
            <div class="stat-label">Java Files</div>
            <div class="stat-value" id="cpp-files">0</div>
            <div class="stat-label">C++ Files</div>
        </div>

        <div class="stat-card">
            <div class="stat-title">📦 Packages</div>
            <div class="stat-value" id="packages">0</div>
            <div class="stat-label">Unique Packages</div>
        </div>

        <button class="refresh-btn" onclick="refreshStats()">🔄 Refresh Statistics</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'updateStats') {
                updateStatsDisplay(message.data);
            }
        });

        function updateStatsDisplay(stats) {
            document.getElementById('percentage').textContent = stats.percentage + '%';
            document.getElementById('progress').style.width = stats.percentage + '%';
            document.getElementById('connection-summary').textContent = 
                stats.connected + ' of ' + stats.total + ' methods connected';
            
            document.getElementById('connected').textContent = stats.connected;
            document.getElementById('missing').textContent = stats.missing;
            document.getElementById('java-files').textContent = stats.javaFiles;
            document.getElementById('cpp-files').textContent = stats.cppFiles;
            document.getElementById('packages').textContent = stats.packages;

            // Update colors based on connection rate
            const percentageEl = document.getElementById('percentage');
            if (stats.percentage === 100) {
                percentageEl.className = 'stat-value success';
            } else if (stats.percentage >= 50) {
                percentageEl.className = 'stat-value warning';
            } else {
                percentageEl.className = 'stat-value error';
            }
        }

        function refreshStats() {
            vscode.postMessage({ type: 'refresh' });
        }
    </script>
</body>
</html>`;
    }
}
