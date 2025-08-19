// src/constants/constantsWebviewProvider.ts
import * as vscode from 'vscode';
import { ConstantsAnalyzer, ConstantInfo } from './constantsAnalyzer';

export class ConstantsWebviewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private lastConstants: ConstantInfo[] = [];

  constructor(private readonly extensionUri: vscode.Uri, private readonly analyzer: ConstantsAnalyzer) {}

  async showConstantsAnalysis(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
      this.updateWebview();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'constantsAnalysis',
      'Constants Analysis',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.command === 'refresh') {
        await this.updateWebview();
      } else if (msg?.command === 'apply' && typeof msg.index === 'number') {
        await this.applyConstant(msg.index);
      } else if (msg?.command === 'open' && typeof msg.index === 'number') {
        await this.openConstantLocation(msg.index);
      }
    });
    await this.updateWebview();
  }

  private async updateWebview() {
    if (!this.panel) return;
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        this.panel.webview.postMessage({ command: 'stats', stats: { total: 0, withSuggestions: 0, highConfidence: 0, files: 0 } });
        this.panel.webview.postMessage({ command: 'data', constants: [] });
        return;
      }
      this.lastConstants = await this.analyzer.analyzeWorkspace(workspaceFolder);
      const total = this.lastConstants.length;
      const withSuggestions = this.lastConstants.filter(c => (c.suggestedNames?.length ?? 0) > 0).length;
      const highConfidence = this.lastConstants.filter(c => (c.confidence ?? 0) >= 70).length;
      const files = new Set(this.lastConstants.map(c => c.file)).size;
      this.panel.webview.postMessage({ command: 'stats', stats: { total, withSuggestions, highConfidence, files } });
      this.panel.webview.postMessage({ command: 'data', constants: this.lastConstants });
    } catch (e) {
      // no-op; keep panel usable even if analyzer not ready
    }
  }

  private async applyConstant(index: number) {
    const item = this.lastConstants[index];
    if (!item) {
      vscode.window.showErrorMessage('Invalid constant selection.');
      return;
    }
    try {
      const uri = vscode.Uri.file(item.file);
      const doc = await vscode.workspace.openTextDocument(uri);
      const nameSuggestion = item.suggestedNames?.[0] || this.toConstName(item.name || 'NEW_CONSTANT');

      const originalText = doc.getText();
      const numberPattern = this.buildNumberRegex(item.value);

      // 1) Determine declaration insertion point (Java: inside containing class if possible)
      let insertOffset = 0;
      let indent = '';
      if (item.language === 'java') {
        const firstMatch = originalText.search(numberPattern);
        if (firstMatch >= 0) {
          const pos = this.findJavaClassInsertionPosition(originalText, firstMatch);
          if (pos) { insertOffset = pos.offset; indent = pos.indent; }
        }
      }

      const declLine = this.buildDeclaration(item.language, nameSuggestion, item.type, item.value);
      const declText = (indent ? indent : '') + declLine + '\n';

      // 2) Build edits: insert declaration, then replace literal occurrences (bottom-up)
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, doc.positionAt(insertOffset), declText);

      const matches: { start: number; end: number }[] = [];
      let m: RegExpExecArray | null;
      const g = new RegExp(numberPattern.source, numberPattern.flags);
      while ((m = g.exec(originalText)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length });
        if (m.index === g.lastIndex) g.lastIndex++; // avoid zero-length loops
      }
      matches.sort((a, b) => b.start - a.start).forEach(r => {
        edit.replace(uri, new vscode.Range(doc.positionAt(r.start), doc.positionAt(r.end)), nameSuggestion);
      });

      const applied = await vscode.workspace.applyEdit(edit);
      if (applied) {
        await doc.save();
        vscode.window.showInformationMessage(`Applied constant ${nameSuggestion} in ${vscode.workspace.asRelativePath(uri)}`);
        await this.updateWebview();
      } else {
        vscode.window.showErrorMessage('Failed to apply edits for constant.');
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Error applying constant: ${String(err)}`);
    }
  }

  private toConstName(raw: string): string {
    return raw
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .replace(/([a-z\d])([A-Z])/g, '$1_$2')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase() || 'NEW_CONSTANT';
  }

  private buildDeclaration(language: 'java' | 'cpp', name: string, type: string, value: string): string {
    const sanitizedType = type || (/^\d+\.\d+$/.test(value) ? 'double' : 'int');
    if (language === 'java') {
      return `public static final ${sanitizedType} ${name} = ${value};`;
    } else {
      // default to C/C++ style const
      return `const ${sanitizedType} ${name} = ${value};`;
    }
  }

  private buildNumberRegex(value: string): RegExp {
    // match exact numeric literal boundaries (not part of identifiers)
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![A-Za-z0-9_\.])${escaped}(?![A-Za-z0-9_])`, 'g');
  }

  private async openConstantLocation(index: number) {
    const item = this.lastConstants[index];
    if (!item) return;
    const uri = vscode.Uri.file(item.file);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const line = Math.max(0, (item.line ?? 0));
    const pos = new vscode.Position(line, 0);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(pos, pos);
  }

  private findJavaClassInsertionPosition(source: string, refOffset: number): { offset: number; indent: string } | null {
    try {
      // Find the nearest "class ... {" before the reference offset
      const classRegex = /class\s+[A-Za-z_][A-Za-z0-9_]*[^\{]*\{/g;
      let match: RegExpExecArray | null;
      let last: RegExpExecArray | null = null;
      while ((match = classRegex.exec(source)) !== null) {
        if (match.index < refOffset) last = match; else break;
      }
      if (!last) return null;
      const braceIndex = last.index + last[0].length - 1; // position of '{'
      // Insert at the next line after '{'
      const nextNewline = source.indexOf('\n', braceIndex);
      const insertAt = nextNewline >= 0 ? nextNewline + 1 : braceIndex + 1;
      // Determine indentation based on following line
      let indent = '';
      if (insertAt < source.length) {
        const lineEnd = source.indexOf('\n', insertAt);
        const lineText = source.slice(insertAt, lineEnd >= 0 ? lineEnd : insertAt + 200);
        const m = lineText.match(/^(\s*)/);
        indent = (m?.[1] ?? '') + '  ';
      }
      return { offset: insertAt, indent };
    } catch {
      return null;
    }
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Constants Analysis</title>
  <style>
    :root { --gap: 12px; }
    body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; }
    .wrap { padding: 16px; }
    .topbar { display: flex; align-items: center; gap: var(--gap); margin-bottom: 12px; }
    .search { flex: 1; display: flex; align-items: center; gap: 8px; }
    .search input { width: 100%; padding: 6px 10px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 6px; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--gap); margin-bottom: 10px; }
    .card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border); padding: 10px; border-radius: 8px; }
    .label { font-size: 11px; color: var(--vscode-descriptionForeground); }
    .value { font-size: 16px; font-weight: 600; margin-top: 4px; }
    .group { margin-top: 12px; border: 1px solid var(--vscode-editorWidget-border); border-radius: 8px; overflow: hidden; }
    .group-header { background: var(--vscode-editorWidget-background); padding: 10px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; }
    .group-title { font-weight: 600; }
    .group-body { padding: 8px 10px; display: none; }
    .group.open .group-body { display: block; }
    .const { display: grid; grid-template-columns: 1fr auto; gap: 6px; padding: 8px; border-bottom: 1px solid var(--vscode-editorWidget-border); }
    .meta { font-size: 11px; color: var(--vscode-descriptionForeground); }
    .name { font-weight: 600; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .chip { font-size: 11px; padding: 2px 6px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .actions { display: flex; align-items: center; gap: 8px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .apply { background: var(--vscode-button-background); }
    .clickable { cursor: pointer; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="search">
        <input id="search" type="text" placeholder="Search by name or value..." />
      </div>
      <button id="refresh">Refresh</button>
    </div>
    <div class="stats">
      <div class="card"><div class="label">Total Constants</div><div class="value" id="total">-</div></div>
      <div class="card"><div class="label">With Suggestions</div><div class="value" id="withSuggestions">-</div></div>
      <div class="card"><div class="label">High Confidence</div><div class="value" id="highConfidence">-</div></div>
      <div class="card"><div class="label">Files</div><div class="value" id="files">-</div></div>
    </div>
    <div id="list"></div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    let all = [];
    let filtered = [];

    function render() {
      const container = document.getElementById('list');
      container.innerHTML = '';
      const groups = groupByFile(filtered);
      Object.keys(groups).sort().forEach(file => {
        const groupEl = document.createElement('div');
        groupEl.className = 'group open';
        const header = document.createElement('div');
        header.className = 'group-header';
        header.innerHTML = '<div class="group-title">📄 ' + file + '</div><div class="meta">' + groups[file].length + ' constants</div>';
        const body = document.createElement('div');
        body.className = 'group-body';
        groups[file].forEach(idx => {
          const c = all[idx];
          const row = document.createElement('div');
          row.className = 'const';
          const left = document.createElement('div');
          left.className = 'clickable';
          const title = document.createElement('div');
          title.className = 'name';
          title.textContent = (c.suggestedNames?.[0] ?? c.name ?? 'NEW_CONSTANT');
          const meta = document.createElement('div');
          meta.className = 'meta';
          meta.textContent = c.language.toUpperCase() + ' • ' + c.type + ' • line ' + (c.line + 1);
          const chips = document.createElement('div');
          chips.className = 'chips';
          (c.suggestedNames || []).slice(0,3).forEach(s => {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.textContent = s;
            chips.appendChild(chip);
          });
          left.appendChild(title);
          left.appendChild(meta);
          left.appendChild(chips);
          left.addEventListener('click', () => vscode.postMessage({ command: 'open', index: idx }));
          const right = document.createElement('div');
          right.className = 'actions';
          const val = document.createElement('span');
          val.className = 'chip';
          val.textContent = String(c.value);
          const btn = document.createElement('button');
          btn.className = 'apply';
          btn.textContent = 'Apply';
          btn.addEventListener('click', () => vscode.postMessage({ command: 'apply', index: idx }));
          right.appendChild(val);
          right.appendChild(btn);
          row.appendChild(left);
          row.appendChild(right);
          body.appendChild(row);
        });
        header.addEventListener('click', () => {
          groupEl.classList.toggle('open');
        });
        groupEl.appendChild(header);
        groupEl.appendChild(body);
        container.appendChild(groupEl);
      });
    }

    function groupByFile(list) {
      const map = {};
      list.forEach(idx => {
        const f = all[idx]?.file || 'Unknown';
        if (!map[f]) map[f] = [];
        map[f].push(idx);
      });
      return map;
    }

    function applySearch(term) {
      const q = (term || '').toLowerCase();
      filtered = all.map((_, i) => i).filter(i => {
        const c = all[i];
        return (
          (c.name || '').toLowerCase().includes(q) ||
          String(c.value || '').toLowerCase().includes(q) ||
          (c.suggestedNames || []).some(s => s.toLowerCase().includes(q)) ||
          (c.file || '').toLowerCase().includes(q)
        );
      });
      render();
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'stats' && msg.stats) {
        document.getElementById('total').textContent = String(msg.stats.total ?? '-');
        document.getElementById('withSuggestions').textContent = String(msg.stats.withSuggestions ?? '-');
        document.getElementById('highConfidence').textContent = String(msg.stats.highConfidence ?? '-');
        document.getElementById('files').textContent = String(msg.stats.files ?? '-');
      } else if (msg.command === 'data') {
        all = Array.isArray(msg.constants) ? msg.constants : [];
        applySearch(document.getElementById('search').value);
      }
    });

    document.getElementById('refresh').addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });
    document.getElementById('search').addEventListener('input', (e) => {
      applySearch(e.target.value);
    });
  </script>
</body>
</html>`;
  }
}
