import * as vscode from 'vscode';
import * as path from 'path';
import { DependencyAnalyzer } from '../core/dependencyAnalyzer';

export class WebviewProvider {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private analyzer: DependencyAnalyzer
    ) {}

    showDependencyGraph(): void {
        if (this.panel) {
            this.panel.reveal();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'dependencyGraph',
            'Dependency Graph',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.panel.webview.html = this.getWebviewContent();
        
        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });

        // Reverted: no message handling for node click actions

        // If no projects analyzed yet, try to analyze once to populate graph
        try {
            const folders = vscode.workspace.workspaceFolders;
            if (folders && this.analyzer.getProjects().length === 0) {
                this.analyzer.analyzeDependencies(folders[0].uri.fsPath).then(() => this.updateWebview());
            } else {
                this.updateWebview();
            }
        } catch {
            this.updateWebview();
        }
    }

    async updateWebview(): Promise<void> {
        if (!this.panel) return;

        const projects = this.analyzer.getProjects();
        const graphData = await this.createGraphData(projects);
        
        this.panel.webview.postMessage({
            command: 'updateGraph',
            data: graphData
        });
    }

    private async createGraphData(projects: any[]): Promise<any> {
        const nodes: any[] = [];
        const links: any[] = [];
        const nodeIdByPath: Map<string, string> = new Map();
        const makeFileNode = (filePath: string, lang: 'java'|'cpp') => {
            if (nodeIdByPath.has(filePath)) return nodeIdByPath.get(filePath)!;
            const id = `file-${lang}-${nodeIdByPath.size}`;
            const name = path.basename(filePath);
            nodes.push({ id, name, type: 'file', language: lang, fullPath: filePath });
            nodeIdByPath.set(filePath, id);
            return id;
        };
        
        projects.forEach((project, projectIndex) => {
            // Add project node
            nodes.push({
                id: `project-${projectIndex}`,
                name: `${project.type} (${project.buildSystem})`,
                type: 'project',
                group: projectIndex,
                buildSystem: project.buildSystem,
                language: project.type
            });
            
            // Add dependency nodes
            project.dependencies.forEach((dep: any, depIndex: number) => {
                const nodeId = `dep-${projectIndex}-${depIndex}`;
                nodes.push({
                    id: nodeId,
                    name: dep.name,
                    version: dep.version,
                    type: 'dependency',
                    group: projectIndex,
                    status: this.getDependencyStatus(dep),
                    platform: dep.platform,
                    conflicts: dep.conflicts,
                    missing: dep.missing,
                    platformIssue: dep.platformIssue
                });
                
                // Add link from project to dependency
                links.push({
                    source: `project-${projectIndex}`,
                    target: nodeId,
                    type: 'uses',
                    weight: 1
                });
            });
        });
        // Cross-language edges using file connections (JNI)
        try {
            const connections = await this.analyzer.getFileConnections();
            // Aggregate by file pair
            const agg = new Map<string, { javaFile: string; cppFile?: string; matched: number; unmatched: number }>();
            for (const c of connections) {
                const key = `${c.javaFile}::${c.cppFile}`;
                if (!agg.has(key)) {
                    agg.set(key, { javaFile: c.javaFile, cppFile: c.isMatched ? c.cppFile : undefined, matched: 0, unmatched: 0 });
                }
                const rec = agg.get(key)!;
                if (c.isMatched) rec.matched++; else rec.unmatched++;
            }

            // Build nodes and links
            const missingByJava: Map<string, number> = new Map();
            agg.forEach(rec => {
                if (rec.cppFile) {
                    const jId = makeFileNode(rec.javaFile, 'java');
                    const cId = makeFileNode(rec.cppFile, 'cpp');
                    const weightRaw = Math.max(1, rec.matched);
                    const weight = Math.min(6, 1 + Math.log(weightRaw));
                    links.push({ source: jId, target: cId, type: 'cross', status: 'matched', weight });
                }
                const missed = rec.unmatched;
                if (missed > 0) {
                    missingByJava.set(rec.javaFile, (missingByJava.get(rec.javaFile) || 0) + missed);
                }
            });

            // For unmatched, add a synthetic node per Java file to visualize missing JNI implementations
            missingByJava.forEach((count, javaPath) => {
                const jId = makeFileNode(javaPath, 'java');
                const missingNodeId = `missing-${jId}`;
                nodes.push({ id: missingNodeId, name: 'Missing JNI', type: 'missingStub', language: 'cpp', fullPath: '' });
                const weight = Math.min(6, 1 + Math.log(Math.max(1, count)));
                links.push({ source: jId, target: missingNodeId, type: 'cross', status: 'unmatched', weight });
            });
        } catch (e) {
            console.warn('Failed to add cross-language connections to graph:', e);
        }
        
        return { nodes, links };
    }

    private getDependencyStatus(dep: any): string {
        if (dep.missing) return 'missing';
        if (dep.conflicts && dep.conflicts.length > 0) return 'conflict';
        if (dep.platformIssue) return 'platform';
        return 'ok';
    }

    private getWebviewContent(): string {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dependency Graph</title>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            background: linear-gradient(135deg, var(--vscode-editor-background) 0%, var(--vscode-sideBar-background) 100%);
            color: var(--vscode-editor-foreground);
            overflow: hidden;
            height: 100vh;
        }

        .container {
            display: flex;
            height: 100vh;
            position: relative;
        }

        .sidebar {
            width: 280px;
            background: var(--vscode-sideBar-background);
            border-right: 1px solid var(--vscode-sideBar-border);
            padding: 20px;
            overflow-y: auto;
            box-shadow: 2px 0 10px rgba(0, 0, 0, 0.1);
        }

        .graph-container {
            flex: 1;
            position: relative;
            background: var(--vscode-editor-background);
        }

        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 15px 20px;
            background: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--vscode-titleBar-border);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .title {
            font-size: 18px;
            font-weight: 600;
            color: var(--vscode-titleBar-activeForeground);
            display: flex;
            align-items: center;
        }

        .title::before {
            content: "🔗";
            margin-right: 10px;
            font-size: 20px;
        }

        .controls {
            display: flex;
            gap: 10px;
        }

        .hover-banner {
            margin-left: 10px;
            padding: 6px 10px;
            background: var(--vscode-editorWidget-background);
            color: var(--vscode-editorWidget-foreground);
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 6px;
            font-size: 12px;
            max-width: 50vw;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            display: inline-block; /* reserve space to avoid reflow */
            min-width: 200px;
            visibility: hidden; /* toggle visibility instead of layout */
        }

        .control-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .control-btn:hover {
            background: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }

        .control-btn:active {
            transform: translateY(0);
        }

        .legend {
            margin-bottom: 30px;
        }

        .legend-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 15px;
            color: var(--vscode-foreground);
            display: flex;
            align-items: center;
        }

        .legend-title::before {
            content: "🏷️";
            margin-right: 8px;
        }

        .legend-item {
            display: flex;
            align-items: center;
            margin-bottom: 12px;
            padding: 8px 12px;
            border-radius: 8px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            transition: all 0.2s ease;
        }

        .legend-item:hover {
            background: var(--vscode-list-hoverBackground);
            transform: translateX(5px);
        }

        .legend-color {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            margin-right: 12px;
            border: 2px solid var(--vscode-editor-foreground);
            position: relative;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        }

        .legend-color::after {
            content: "";
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.3);
        }

        .legend-text {
            font-size: 13px;
            font-weight: 500;
        }

        .stats {
            margin-top: 30px;
            padding: 20px;
            background: var(--vscode-editor-background);
            border-radius: 12px;
            border: 1px solid var(--vscode-panel-border);
        }

        .stats-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 15px;
            color: var(--vscode-foreground);
            display: flex;
            align-items: center;
        }

        .stats-title::before {
            content: "📊";
            margin-right: 8px;
        }

        .stat-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            padding: 6px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .stat-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .stat-value {
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        #graph {
            width: 100%;
            height: calc(100vh - 60px);
        }

        .node {
            cursor: pointer;
            transition: all 0.2s ease;
            filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3));
        }

        .node:hover {
            transform: scale(1.1);
            filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.4));
        }

        .node.project {
            fill: url(#projectGradient);
            stroke: var(--vscode-button-background);
            stroke-width: 3px;
        }

        .node.dependency.ok {
            fill: url(#okGradient);
            stroke: #4ade80;
            stroke-width: 2px;
        }

        .node.dependency.conflict {
            fill: url(#conflictGradient);
            stroke: #f59e0b;
            stroke-width: 2px;
        }

        .node.dependency.missing {
            fill: url(#missingGradient);
            stroke: #ef4444;
            stroke-width: 2px;
        }

        .node.dependency.platform {
            fill: url(#platformGradient);
            stroke: #3b82f6;
            stroke-width: 2px;
        }

        .link {
            stroke: var(--vscode-editor-foreground);
            stroke-opacity: 0.4;
            stroke-width: 2px;
            transition: all 0.2s ease;
        }

        .link:hover {
            stroke-opacity: 0.8;
            stroke-width: 3px;
        }

        /* Link type/status styling */
        .link.uses { stroke: var(--vscode-editor-foreground); }
        .link.cross.matched { stroke: #22c55e; }
        .link.cross.unmatched { stroke: #ef4444; stroke-dasharray: 4 3; }

        /* Focus mode */
        .faded { opacity: 0.15; }

        /* File (JNI) node coloring */
        .node.file.java { fill: #f59e0b; stroke: #b45309; stroke-width: 2px; }
        .node.file.cpp { fill: #38bdf8; stroke: #0ea5e9; stroke-width: 2px; }
        .node-label {
            font-size: 11px;
            text-anchor: middle;
            dominant-baseline: middle;
            pointer-events: none;
            fill: var(--vscode-editor-foreground);
            font-weight: 600;
            text-shadow: 0 0 3px var(--vscode-editor-background);
        }

        .node-version {
            font-size: 9px;
            text-anchor: middle;
            pointer-events: none;
            fill: var(--vscode-descriptionForeground);
            font-weight: 500;
        }

        .tooltip {
            position: absolute;
            background: var(--vscode-editorWidget-background);
            color: var(--vscode-editorWidget-foreground);
            border: 1px solid var(--vscode-editorWidget-border);
            padding: 10px;
            border-radius: 8px;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
            display: none;
            z-index: 1000;
            pointer-events: none;
            max-width: 700px;
            word-break: break-all;
            white-space: normal;
        }

        .tooltip.visible {
            opacity: 1;
        }

        .tooltip-title {
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }

        .tooltip-detail {
            margin-bottom: 4px;
            color: var(--vscode-descriptionForeground);
        }

        .tooltip-status {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
            margin-top: 8px;
        }

        .tooltip-status.ok {
            background: #4ade80;
            color: #1f2937;
        }

        .tooltip-status.conflict {
            background: #f59e0b;
            color: #1f2937;
        }

        .tooltip-status.missing {
            background: #ef4444;
            color: #ffffff;
        }

        .tooltip-status.platform {
            background: #3b82f6;
            color: #ffffff;
        }

        .search-box {
            width: 100%;
            padding: 12px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: 13px;
            margin-bottom: 20px;
            transition: all 0.2s ease;
        }

        .search-box:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
        }

        .search-box::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        .loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100%;
            flex-direction: column;
        }

        .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid var(--vscode-progressBar-background);
            border-top: 4px solid var(--vscode-button-background);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .loading-text {
            margin-top: 15px;
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }

        @media (max-width: 1024px) {
            .sidebar {
                width: 240px;
            }
        }

        @media (max-width: 768px) {
            .container {
                flex-direction: column;
            }
            
            .sidebar {
                width: 100%;
                height: 200px;
            }
            
            .graph-container {
                height: calc(100vh - 200px);
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="sidebar">
            <input type="text" class="search-box" placeholder="🔍 Search dependencies..." id="searchBox">
            <div class="legend" style="margin-bottom: 12px;">
                <div class="legend-title">Filters</div>
                <div class="legend-item">
                    <input type="checkbox" id="filterUses" checked style="margin-right:8px;" />
                    <span class="legend-text">Show Project → Dependency</span>
                </div>
                <div class="legend-item">
                    <input type="checkbox" id="filterCross" style="margin-right:8px;" />
                    <span class="legend-text">Show Java ↔ C++</span>
                </div>
                <div class="legend-item" style="display:flex;gap:8px;align-items:center;">
                    <span class="legend-text">Status:</span>
                    <select id="statusFilter" style="flex:1;background: var(--vscode-input-background); color: var(--vscode-input-foreground); border:1px solid var(--vscode-input-border); padding:6px; border-radius:6px;">
                        <option value="all">All</option>
                        <option value="ok">Healthy</option>
                        <option value="conflict">Conflict</option>
                        <option value="missing">Missing</option>
                        <option value="platform">Platform</option>
                        <option value="matched">JNI Matched</option>
                        <option value="unmatched">JNI Missing</option>
                    </select>
                </div>
            </div>

            <div class="legend">
                <div class="legend-title">Status Legend</div>
                <div class="legend-item">
                    <div class="legend-color" style="background: linear-gradient(45deg, #4ade80, #22c55e);"></div>
                    <span class="legend-text">✅ Healthy</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: linear-gradient(45deg, #f59e0b, #d97706);"></div>
                    <span class="legend-text">⚠️ Version Conflict</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: linear-gradient(45deg, #ef4444, #dc2626);"></div>
                    <span class="legend-text">❌ Missing</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: linear-gradient(45deg, #3b82f6, #2563eb);"></div>
                    <span class="legend-text">🔧 Platform Issue</span>
                </div>
            </div>

            <div class="stats">
                <div class="stats-title">Statistics</div>
                <div class="stat-item">
                    <span class="stat-label">Total Projects</span>
                    <span class="stat-value" id="totalProjects">0</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Total Dependencies</span>
                    <span class="stat-value" id="totalDependencies">0</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Conflicts</span>
                    <span class="stat-value" id="conflictCount">0</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Missing</span>
                    <span class="stat-value" id="missingCount">0</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Platform Issues</span>
                    <span class="stat-value" id="platformCount">0</span>
                </div>
            </div>
        </div>

        <div class="graph-container">
            <div class="header">
                <div class="title">Dependency Graph</div>
                <div class="controls">
                    <button class="control-btn" id="zoomIn">🔍 Zoom In</button>
                    <button class="control-btn" id="zoomOut">🔍 Zoom Out</button>
                    <button class="control-btn" id="resetZoom">🎯 Reset</button>
                    <button class="control-btn" id="exportGraph">💾 Export</button>
                    <div class="hover-banner" id="hoverBanner" title="Full path appears here on hover"></div>
                </div>
            </div>
            
            <svg id="graph">
                <defs>
                    <linearGradient id="projectGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#6366f1;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
                    </linearGradient>
                    <linearGradient id="okGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#4ade80;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#22c55e;stop-opacity:1" />
                    </linearGradient>
                    <linearGradient id="conflictGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#f59e0b;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#d97706;stop-opacity:1" />
                    </linearGradient>
                    <linearGradient id="missingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#ef4444;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#dc2626;stop-opacity:1" />
                    </linearGradient>
                    <linearGradient id="platformGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#2563eb;stop-opacity:1" />
                    </linearGradient>
                </defs>
            </svg>
            
            <div class="loading" id="loading">
                <div class="spinner"></div>
                <div class="loading-text">Loading dependency graph...</div>
            </div>
        </div>
    </div>

    <div class="tooltip" id="tooltip">
        <div class="tooltip-title"></div>
        <div class="tooltip-details"></div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const svg = d3.select("#graph");
        const width = window.innerWidth - 280;
        const height = window.innerHeight - 60;
        
        svg.attr("width", width).attr("height", height);
        
        let simulation;
        let nodes = [];
        let links = [];
        let zoomBehavior;
        
        const tooltip = d3.select("#tooltip");
        
        // Initialize zoom behavior
        zoomBehavior = d3.zoom()
            .scaleExtent([0.1, 3])
            .on("zoom", function(event) {
                svg.select(".graph-content").attr("transform", event.transform);
            });
        
        svg.call(zoomBehavior);
        
        // Create main group for graph content
        const graphGroup = svg.append("g").attr("class", "graph-content");
        
        function showLoading() {
            document.getElementById('loading').style.display = 'flex';
        }
        
        function hideLoading() {
            document.getElementById('loading').style.display = 'none';
        }
        
        function updateStats(data) {
            const projects = data.nodes.filter(n => n.type === 'project');
            const dependencies = data.nodes.filter(n => n.type === 'dependency');
            const conflicts = dependencies.filter(n => n.status === 'conflict');
            const missing = dependencies.filter(n => n.status === 'missing');
            const platform = dependencies.filter(n => n.status === 'platform');
            
            document.getElementById('totalProjects').textContent = projects.length;
            document.getElementById('totalDependencies').textContent = dependencies.length;
            document.getElementById('conflictCount').textContent = conflicts.length;
            document.getElementById('missingCount').textContent = missing.length;
            document.getElementById('platformCount').textContent = platform.length;
        }
        
        function updateGraph(data) {
            showLoading();
            
            setTimeout(() => {
                nodes = data.nodes;
                links = data.links;
                
                updateStats(data);
                
                graphGroup.selectAll("*").remove();
                
                simulation = d3.forceSimulation(nodes)
                    .force("link", d3.forceLink(links).id(d => d.id).distance(d => d.type === 'cross' ? 160 : 110))
                    .force("charge", d3.forceManyBody().strength(-400))
                    .force("center", d3.forceCenter(width / 2, height / 2))
                    .force("x", d3.forceX(d => (d.group != null ? (width / 2 + (d.group - 0.5) * 40) : width / 2)).strength(0.05))
                    .force("y", d3.forceY(d => (d.group != null ? (height / 2 + (d.group - 0.5) * 20) : height / 2)).strength(0.05))
                    .force("collision", d3.forceCollide().radius(d => d.type === 'project' ? 35 : 25));
                
                const link = graphGroup.append("g")
                    .selectAll("line")
                    .data(links)
                    .join("line")
                    .attr("class", d => 'link ' + d.type + ' ' + (d.status || ''))
                    .attr("stroke-width", d => {
                        const w = d.weight || 1;
                        return d.type === 'cross' ? Math.min(6, 1 + Math.log(Math.max(1, w))) : 2;
                    });
                
                const node = graphGroup.append("g")
                    .selectAll("circle")
                    .data(nodes)
                    .join("circle")
                    .attr("class", d => 'node ' + d.type + ' ' + (d.status || '') + ' ' + (d.language || ''))
                    .attr("r", d => d.type === 'project' ? 25 : (d.type === 'file' ? 12 : 18))
                    .call(d3.drag()
                        .on("start", dragstarted)
                        .on("drag", dragged)
                        .on("end", dragended))
                    .on("mouseenter", function(event, d) { 
                        // Cancel any pending unpin
                        if (unpinTimer) { clearTimeout(unpinTimer); unpinTimer = null; }
                        // Pin the node so it doesn't move while reading tooltip/banner
                        hoveredNodeId = d.id;
                        d.fx = d.x; d.fy = d.y;
                        d.vx = 0; d.vy = 0;
                        simulation.alphaTarget(0); // do not restart to avoid jiggle
                        showTooltip(event, d);
                    })
                    .on("mousemove", function(event, d) { showTooltip(event, d); })
                    .on("mouseleave", function(event, d) { 
                        // Unpin after a short delay to reduce flicker when moving toward banner
                        const nodeRef = d;
                        unpinTimer = setTimeout(() => {
                            if (hoveredNodeId === nodeRef.id) hoveredNodeId = null;
                            nodeRef.fx = null; nodeRef.fy = null;
                            simulation.alphaTarget(0.02);
                        }, 1000);
                        hideTooltip();
                    });
                
                const label = graphGroup.append("g")
                    .selectAll("text")
                    .data(nodes)
                    .join("text")
                    .attr("class", "node-label")
                    .text(d => {
                        const maxLength = d.type === 'project' ? 15 : 12;
                        return d.name.length > maxLength ? d.name.substring(0, maxLength) + '...' : d.name;
                    });
                
                const versionLabel = graphGroup.append("g")
                    .selectAll("text")
                    .data(nodes.filter(d => d.type === 'dependency'))
                    .join("text")
                    .attr("class", "node-version")
                    .text(d => d.version);
                
                simulation.on("tick", () => {
                    link
                        .attr("x1", d => d.source.x)
                        .attr("y1", d => d.source.y)
                        .attr("x2", d => d.target.x)
                        .attr("y2", d => d.target.y);
                    
                    node
                        .attr("cx", d => {
                            if (hoveredNodeId && d.id === hoveredNodeId && d.fx != null) { d.x = d.fx; d.vx = 0; }
                            return d.x;
                        })
                        .attr("cy", d => {
                            if (hoveredNodeId && d.id === hoveredNodeId && d.fy != null) { d.y = d.fy; d.vy = 0; }
                            return d.y;
                        });
                    
                    label
                        .attr("x", d => d.x)
                        .attr("y", d => d.y - 2);
                    
                    versionLabel
                        .attr("x", d => d.x)
                        .attr("y", d => d.y + 12);
                });
                
                hideLoading();
            }, 500);
        }
        
        let hoveredNodeId = null;
        let unpinTimer = null;

        function showTooltip(event, d) {
            const tooltip = document.getElementById('tooltip');
            const title = tooltip.querySelector('.tooltip-title');
            const details = tooltip.querySelector('.tooltip-details');
            const banner = document.getElementById('hoverBanner');
            
            // Use full path for file nodes so long names are fully visible
            if (d.type === 'file' && d.fullPath) {
                title.textContent = d.fullPath;
                // Also set stable banner in header that doesn't move with cursor
                if (banner) {
                    banner.textContent = d.fullPath;
                    banner.setAttribute('title', d.fullPath);
                    banner.style.visibility = 'visible';
                }
            } else {
                title.textContent = d.name;
                if (banner) {
                    banner.textContent = d.name;
                    banner.setAttribute('title', d.name);
                    banner.style.visibility = 'visible';
                }
            }
            
            let detailsHTML = '';
            if (d.type === 'project') {
                detailsHTML = (
                    '<div class="tooltip-detail">Type: ' + d.language.toUpperCase() + '</div>' +
                    '<div class="tooltip-detail">Build System: ' + d.buildSystem + '</div>' +
                    '<div class="tooltip-detail">Dependencies: ' + links.filter(l => (l.source.id ?? l.source) === d.id).length + '</div>'
                );
            } else if (d.type === 'dependency') {
                // Avoid nested template literals inside outer template string: use concatenation
                detailsHTML = (
                    (d.platform ? '<div class="tooltip-detail">Platform: ' + d.platform + '</div>' : '') +
                    (d.conflicts ? '<div class="tooltip-detail">Conflicts: ' + d.conflicts.join(', ') + '</div>' : '') +
                    '<div class="tooltip-status ' + d.status + '">' + getStatusText(d.status) + '</div>'
                );
            } else if (d.type === 'file') {
                detailsHTML = (
                    d.fullPath ? '<div class="tooltip-detail">' + d.fullPath + '</div>' : ''
                );
            } else if (d.type === 'missingStub') {
                const count = links.find(l => ((l.target.id ?? l.target) === d.id) && l.status === 'unmatched')?.weight || '';
                detailsHTML = '<div class="tooltip-detail">Unmatched JNI methods ' + (count ? '(' + Math.round(count) + ')' : '') + '</div>';
            } else {
                detailsHTML = '<div class="tooltip-status ' + d.status + '">' + getStatusText(d.status) + '</div>';
            }
            
            details.innerHTML = detailsHTML;
            
            tooltip.style.left = (event.pageX + 12) + 'px';
            tooltip.style.top = (event.pageY + 12) + 'px';
            tooltip.classList.add('visible');
        }
        
        function hideTooltip() {
            document.getElementById('tooltip').classList.remove('visible');
            const banner = document.getElementById('hoverBanner');
            if (banner) {
                banner.style.visibility = 'hidden';
                banner.textContent = '';
                banner.removeAttribute('title');
            }
        }

        // Receive data from extension and update graph
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg && msg.command === 'updateGraph') {
                updateGraph(msg.data);
            }
        });
        // Search filtering for nodes/links
        const searchBox = document.getElementById('searchBox');
        if (searchBox) {
            // Live filter (fade non-matching)
            searchBox.addEventListener('input', function() {
                const term = this.value.toLowerCase();
                const matchNode = n => !term || (n.name && n.name.toLowerCase().includes(term)) || (n.fullPath && n.fullPath.toLowerCase().includes(term));
                const matchedIds = new Set(nodes.filter(matchNode).map(n => n.id));

                // Fade nodes
                graphGroup.selectAll('circle')
                    .classed('faded', d => !matchNode(d));

                // Fade labels
                graphGroup.selectAll('text.node-label')
                    .classed('faded', d => !matchNode(d));

                // Fade links where neither end matches
                graphGroup.selectAll('line')
                    .classed('faded', l => !(matchedIds.has(l.source.id ?? l.source) || matchedIds.has(l.target.id ?? l.target)));
            });

            // Enter-to-focus
            searchBox.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    const term = this.value.toLowerCase();
                    const match = nodes.find(n => n.name && n.name.toLowerCase().includes(term));
                    if (match) {
                        applyFocus(match.id);
                        const t = d3.zoomIdentity.translate(width/2 - (match.x||0), height/2 - (match.y||0)).scale(1.2);
                        svg.transition().duration(300).call(zoomBehavior.transform, t);
                    }
                }
            });
        }

        function getStatusText(status) {
            switch(status) {
                case 'ok': return '✅ Healthy';
                case 'conflict': return '⚠️ Version Conflict';
                case 'missing': return '❌ Missing';
                case 'platform': return '🔧 Platform Issue';
                default: return '❓ Unknown';
            }
        }
        
        function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }
        
        function dragged(event, d) {
            d.fx = event.x;
            d.fy = event.y;
        }
        
        function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }
        
        // Control buttons
        document.getElementById('zoomIn').addEventListener('click', () => {
            svg.transition().duration(300).call(zoomBehavior.scaleBy, 1.5);
        });
        
        document.getElementById('zoomOut').addEventListener('click', () => {
            svg.transition().duration(300).call(zoomBehavior.scaleBy, 0.67);
        });
        
        document.getElementById('resetZoom').addEventListener('click', () => {
            svg.transition().duration(500).call(zoomBehavior.transform, d3.zoomIdentity);
        });
        
        document.getElementById('exportGraph').addEventListener('click', () => {
            // Export functionality would go here
            alert('Export functionality to be implemented');
        });
        
        // (Removed duplicate searchBox declaration and listeners to avoid redefinition errors)

        // Filters (hide cross by default). Also hide nodes with no visible links.
        function applyFilters() {
            const showUses = (document.getElementById('filterUses')).checked;
            const showCross = (document.getElementById('filterCross')).checked;
            const status = (document.getElementById('statusFilter')).value;

            const isLinkVisible = (d) => {
                const typeOk = (showUses && d.type === 'uses') || (showCross && d.type === 'cross');
                const statusOk = status === 'all' || (d.status === status) || (status === 'ok' && (d.type === 'uses'));
                return typeOk && statusOk;
            };

            graphGroup.selectAll('.link')
                .style('display', d => (isLinkVisible(d) ? null : 'none'));

            // Compute visible node ids
            const visibleNodeIds = new Set();
            links.forEach(l => {
                if (isLinkVisible(l)) {
                    const sid = l.source.id ?? l.source; const tid = l.target.id ?? l.target;
                    visibleNodeIds.add(sid); visibleNodeIds.add(tid);
                }
            });
            graphGroup.selectAll('.node').style('display', d => visibleNodeIds.has(d.id) ? null : 'none');
            graphGroup.selectAll('.node-label').style('display', d => visibleNodeIds.has(d.id) ? null : 'none');
        }
        document.getElementById('filterUses').addEventListener('change', applyFilters);
        document.getElementById('filterCross').addEventListener('change', applyFilters);
        document.getElementById('statusFilter').addEventListener('change', applyFilters);

        // Make Uses and Cross mutually exclusive to satisfy "only cross-language" view
        const usesCb = document.getElementById('filterUses');
        const crossCb = document.getElementById('filterCross');
        usesCb.addEventListener('change', () => {
            if (usesCb.checked) { crossCb.checked = false; }
            applyFilters();
        });
        crossCb.addEventListener('change', () => {
            if (crossCb.checked) { usesCb.checked = false; }
            applyFilters();
        });

        // Focus mode
        function applyFocus(nodeId) {
            const neighborIds = new Set([nodeId]);
            links.forEach(l => {
                const sid = l.source.id ?? l.source; const tid = l.target.id ?? l.target;
                if (sid === nodeId) neighborIds.add(tid);
                if (tid === nodeId) neighborIds.add(sid);
            });
            graphGroup.selectAll('.node').classed('faded', d => !neighborIds.has(d.id));
            graphGroup.selectAll('.node-label').classed('faded', d => !neighborIds.has(d.id));
            graphGroup.selectAll('.link').classed('faded', l => {
                const sid = l.source.id ?? l.source; const tid = l.target.id ?? l.target;
                return sid !== nodeId && tid !== nodeId;
            });
        }
        // Clear focus on background click
        svg.on('click', function() {
            graphGroup.selectAll('.faded').classed('faded', false);
        });
        
        // Window resize handler
        window.addEventListener('resize', () => {
            const newWidth = window.innerWidth - 280;
            const newHeight = window.innerHeight - 60;
            svg.attr("width", newWidth).attr("height", newHeight);
            simulation.force("center", d3.forceCenter(newWidth / 2, newHeight / 2));
            simulation.restart();
        });
        
        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateGraph') {
                updateGraph(message.data);
                setTimeout(applyFilters, 0);
            }
        });
        
        // Initialize with loading state
        showLoading();
    </script>
</body>
</html>`;
    }
}
