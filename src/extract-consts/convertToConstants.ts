// src/features/convertToConstants.ts

import * as vscode from "vscode";

// --- TYPE DEFINITIONS ---
type LanguageId = "c" | "java";
type ConstantDataType = "int" | "double";

interface ConstantLocation {
  line: number;
  text: string;
}

interface ConstantUsageInfo {
  locations: ConstantLocation[];
  uri: vscode.Uri;
  linesInserted: number;
}

interface NumberOccurrence {
  position: vscode.Position;
  text: string;
}

interface ConstantMapping {
  name: string;
  comment: string;
  type: ConstantDataType;
}

// --- MODULE STATE ---
// State is encapsulated here, accessible only by this feature's functions.
const generatedConstantsInfo: Map<string, ConstantUsageInfo> = new Map();

// --- HELPER FUNCTIONS ---
function toSnakeCase(str: string): string {
  if (!str) return "";
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[-\s]/g, "_")
    .toUpperCase();
}

function inferDataType(numberStr: string): ConstantDataType {
  return numberStr.includes(".") ? "double" : "int";
}

function getVariableDeclarationRegex(languageId: LanguageId): RegExp {
  const typeKeywords = "(?:int|float|double|long|short|char|byte)";
  if (languageId === "java") {
    return new RegExp(
      `(?:${typeKeywords}|[A-Z][a-zA-Z0-9_]*)\\s+([a-zA-Z0-9_]+)\\s*=`
    );
  }
  return new RegExp(`${typeKeywords}\\s+([a-zA-Z0-9_]+)\\s*=`);
}

function generateContextualComment(
  contextText: string,
  number: string,
  languageId: LanguageId
): string {
  const numValue = parseFloat(number);
  if (contextText.includes("*")) {
    if (numValue > 1) {
      return `// Represents a multiplier, such as a tax or growth rate of ${(
        (numValue - 1) *
        100
      ).toFixed(2)}%.`;
    }
    if (numValue < 1 && numValue > 0) {
      return `// Represents a percentage or factor, such as a discount of ${(
        (1 - numValue) *
        100
      ).toFixed(2)}%.`;
    }
  }
  if (contextText.match(/\+\s*\d/)) {
    if (
      contextText.toLowerCase().includes("shipping") ||
      contextText.toLowerCase().includes("fee")
    ) {
      return `// A fixed fee, such as for shipping or processing.`;
    }
    return `// An offset or fixed addition to a value.`;
  }
  let match = contextText.match(/(?:if|while)\s*\((.*)\)/);
  if (match) {
    const condition = match[1];
    if (
      condition.toLowerCase().includes("count") ||
      condition.toLowerCase().includes("retries") ||
      condition.toLowerCase().includes("length")
    ) {
      return `// The maximum number of attempts, items, or retries allowed.`;
    }
    return `// A threshold used to control logic flow.`;
  }
  return `// Defines a constant value.`;
}

function suggestConstantName(
  contextText: string,
  number: string,
  languageId: LanguageId
): string {
  const numValue = parseFloat(number);
  let match = contextText.match(getVariableDeclarationRegex(languageId));
  if (match && match[1]) return toSnakeCase(match[1]);

  match = contextText.match(/([a-zA-Z0-9_.]+)\s*(?:>|<|>=|<=|==|!=)/);
  if (match && match[1]) {
    const varName = match[1].toLowerCase();
    if (varName.includes("count") || varName.includes("retries"))
      return "MAX_RETRIES";
    if (varName.includes("length")) return "MAX_LENGTH";
    const varParts = match[1].split(".");
    const baseName = varParts[varParts.length - 1];
    return `${toSnakeCase(baseName)}_THRESHOLD`;
  }

  if (contextText.includes("*")) {
    if (numValue > 1) return "TAX_RATE_MULTIPLIER";
    if (numValue < 1 && numValue > 0) return "DISCOUNT_FACTOR";
  }
  return "NEW_CONSTANT";
}

// --- EXPORTED FUNCTIONS ---

/**
 * The core logic for the "Convert to Constants" command.
 * This is exported to be registered in the main extension.ts file.
 */
export async function convertMagicNumbersToConstants() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("Open a C or Java file to use this feature.");
    return;
  }

  const document = editor.document;
  const languageId = document.languageId as LanguageId;
  const supportedLanguages: LanguageId[] = ["c", "java"];

  if (!supportedLanguages.includes(languageId)) {
    vscode.window.showInformationMessage(`This command is only available for C and Java files.`);
    return;
  }

  generatedConstantsInfo.clear();

  const text = document.getText();
  const numberOccurrences: Map<string, NumberOccurrence[]> = new Map();
  const numberRegex = /(?<![a-zA-Z0-9_])(\d+(\.\d+)?)(?![a-zA-Z0-9_])/g;
  let match;

  while ((match = numberRegex.exec(text)) !== null) {
    const position = document.positionAt(match.index);
    const line = document.lineAt(position.line);
    if (line.text.trim().match(/^(?:const|final)\s/)) continue;
    const numberStr = match[1];
    if (!numberOccurrences.has(numberStr)) {
      numberOccurrences.set(numberStr, []);
    }
    numberOccurrences.get(numberStr)?.push({
      position,
      text: line.text.trim(),
    });
  }

  if (numberOccurrences.size === 0) {
    vscode.window.showInformationMessage("No magic numbers found to convert.");
    return;
  }

  const uniqueNumbers = Array.from(numberOccurrences.keys());
  const constantMappings: Map<string, ConstantMapping> = new Map();

  for (const number of uniqueNumbers) {
    const firstOccurrence = (numberOccurrences.get(number) as NumberOccurrence[])[0];
    const suggestedName = suggestConstantName(firstOccurrence.text, number, languageId);
    const contextualComment = generateContextualComment(firstOccurrence.text, number, languageId);
    const constantName = await vscode.window.showInputBox({
      prompt: `Enter constant name for "${number}"`,
      value: suggestedName,
      placeHolder: "e.g., MAX_RETRIES",
      validateInput: (text) =>
        /^[A-Z_][A-Z0-9_]*$/.test(text)
          ? null
          : "Invalid constant name (use UPPER_SNAKE_CASE)",
    });

    if (constantName) {
      constantMappings.set(number, {
        name: constantName,
        comment: contextualComment,
        type: inferDataType(number),
      });
    } else {
      vscode.window.showInformationMessage("Number conversion cancelled.");
      return;
    }
  }

  if (constantMappings.size > 0) {
    await editor.edit((editBuilder) => {
      // Replace numbers with constant names first (from bottom to top)
      const edits: { range: vscode.Range; text: string }[] = [];
      constantMappings.forEach((data, num) => {
        const occurrencesToReplace = numberOccurrences.get(num) as NumberOccurrence[];
        occurrencesToReplace.forEach((occ) => {
          const startPos = occ.position;
          const endPos = startPos.translate(0, num.length);
          edits.push({ range: new vscode.Range(startPos, endPos), text: data.name });
        });
      });
      edits.sort((a, b) => b.range.start.compareTo(a.range.start));
      edits.forEach((edit) => editBuilder.replace(edit.range, edit.text));

      // Then, insert the constant declarations at the top
      let constantsDeclarations = "";
      constantMappings.forEach((data, num) => {
        switch (languageId) {
          case "java":
            constantsDeclarations += `${data.comment}\npublic static final ${data.type} ${data.name} = ${num};\n`;
            break;
          case "c":
            constantsDeclarations += `${data.comment}\nconst ${data.type} ${data.name} = ${num};\n`;
            break;
        }
      });
      editBuilder.insert(new vscode.Position(0, 0), constantsDeclarations + "\n");
    });
    vscode.window.showInformationMessage("Successfully converted numbers to constants!");
  }
}

/**
 * Registers the hover provider for this feature.
 * This is exported to be registered in the main extension.ts file.
 * @param context The extension context to push the subscription to.
 */
export function registerConvertConstantsHoverProvider(context: vscode.ExtensionContext) {
  const supportedLanguages: LanguageId[] = ["c", "java"];

  const hoverProvider = vscode.languages.registerHoverProvider(supportedLanguages, {
    provideHover(document: vscode.TextDocument, position: vscode.Position) {
      const range = document.getWordRangeAtPosition(position);
      if (!range) return null;

      const word = document.getText(range);
      if (generatedConstantsInfo.has(word)) {
        const lineText = document.lineAt(position.line).text;
        const isDeclaration =
          lineText.includes(word) &&
          (lineText.includes("final") || lineText.trim().startsWith("const"));

        if (isDeclaration) {
          // Hover logic for showing usage information
        }
      }
      return null;
    },
  });

  context.subscriptions.push(hoverProvider);
}