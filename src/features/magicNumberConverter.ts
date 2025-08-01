// src/features/magicNumberConverter.ts

import * as vscode from "vscode";

// Define clear types for our data structures
type LanguageId = "c" | "java";
type ConstantType = "int" | "double";

interface CodeLocation {
  line: number;
  text: string;
}

interface ConstantInfo {
  locations: CodeLocation[];
  uri: vscode.Uri;
  linesInserted: number;
}

interface NumberOccurrence {
  position: vscode.Position;
  text: string;
}

interface ConstantData {
  name: string;
  comment: string;
  type: ConstantType;
}

// Module-level state for the HoverProvider.
const generatedConstantsInfo = new Map<string, ConstantInfo>();

/**
 * Converts a string from camelCase or PascalCase to UPPER_SNAKE_CASE.
 * @param str The string to convert.
 * @returns The converted string.
 */
function toSnakeCase(str: string): string {
  if (!str) return "";
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[-\s]/g, "_")
    .toUpperCase();
}

/**
 * Infers the data type of a number for C/Java.
 * @param numberStr The number as a string.
 * @returns The inferred data type.
 */
function inferDataType(numberStr: string): ConstantType {
  return numberStr.includes(".") ? "double" : "int";
}

/**
 * Gets the language-specific regex for variable declarations.
 * @param languageId The language ID ('c' or 'java').
 * @returns The regex for matching variable declarations.
 */
function getVariableDeclarationRegex(languageId: LanguageId): RegExp {
  const typeKeywords = "(?:int|float|double|long|short|char|byte)";
  if (languageId === "java") {
    // Java can also have other class types (e.g., String)
    return new RegExp(
      `(?:${typeKeywords}|[A-Z][a-zA-Z0-9_]*)\\s+([a-zA-Z0-9_]+)\\s*=`
    );
  }
  // C regex is simpler
  return new RegExp(`${typeKeywords}\\s+([a-zA-Z0-9_]+)\\s*=`);
}

/**
 * Generates a more descriptive comment based on the number's deeper context.
 * @param contextText The line of code where the number was found.
 * @param number The number as a string.
 * @param languageId The language ID.
 * @returns An explanatory comment.
 */
function generateContextualComment(
  contextText: string,
  number: string,
  languageId: LanguageId
): string {
  const numValue = parseFloat(number);

  // Rule 1: Calculation context
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

  // Rule 2: Comparison context
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

  // Rule 3: Loop condition
  if (contextText.startsWith("for")) {
    return `// Defines the maximum number of iterations for a loop.`;
  }

  // Rule 4: Function/Method Argument context
  match = contextText.match(/([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
  if (match && match[2].includes(number)) {
    const functionName = match[1].toLowerCase();
    if (
      functionName.includes("timeout") ||
      functionName.includes("delay") ||
      functionName.includes("sleep")
    ) {
      return `// The duration in milliseconds for a timeout or delay.`;
    }
    if (functionName.includes("port") || functionName.includes("listen")) {
      return `// The network port for a server or connection.`;
    }
    return `// A parameter for the ${match[1]} function.`;
  }

  // Rule 5: Variable Assignment context
  match = contextText.match(getVariableDeclarationRegex(languageId));
  if (match && match[1]) {
    const varName = match[1].toLowerCase();
    if (varName.includes("rate"))
      return `// The rate for a calculation, e.g., tax or interest.`;
    if (varName.includes("port"))
      return `// The network port for a server or connection.`;
    return `// The default or initial value for ${match[1]}.`;
  }

  return `// Defines a constant value.`;
}

/**
 * Suggests a more contextual constant name based on deeper analysis.
 * @param contextText The line of code where the number was found.
 * @param number The number as a string.
 * @param languageId The language ID.
 * @returns A suggested constant name.
 */
function suggestConstantName(
  contextText: string,
  number: string,
  languageId: LanguageId
): string {
  const numValue = parseFloat(number);

  // Rule 1: Variable Assignment
  let match = contextText.match(getVariableDeclarationRegex(languageId));
  if (match && match[1]) return toSnakeCase(match[1]);

  // Rule 2: Function/Method Argument
  match = contextText.match(/([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
  if (match && match[2].includes(number)) {
    const functionName = match[1].toLowerCase();
    if (functionName.includes("listen") || functionName.includes("port"))
      return "SERVER_PORT";
    if (functionName.includes("timeout")) return "TIMEOUT_DURATION_MS";
    if (functionName.includes("delay") || functionName.includes("sleep"))
      return "DELAY_MS";
    const sanitizedNumber = number.replace(/\./g, "_");
    return `DEFAULT_${toSnakeCase(functionName)}_${sanitizedNumber}`;
  }

  // Rule 3: Calculation
  if (contextText.includes("*")) {
    if (numValue > 1) return "TAX_RATE_MULTIPLIER";
    if (numValue < 1 && numValue > 0) return "DISCOUNT_FACTOR";
  }
  if (contextText.match(/\+\s*\d/)) {
    if (contextText.toLowerCase().includes("shipping")) return "SHIPPING_FEE";
    if (contextText.toLowerCase().includes("fee")) return "PROCESSING_FEE";
  }

  // Rule 4: Comparison
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

  // Rule 5: Loop condition
  if (
    contextText.startsWith("for") &&
    (contextText.includes(`< ${number}`) ||
      contextText.includes(`<= ${number}`))
  )
    return "MAX_ITERATIONS";

  return "NEW_CONSTANT";
}

/**
 * Registers the commands and providers for the magic number converter feature.
 * @param context The extension context to push subscriptions to.
 */
export function registerMagicNumberFeatures(context: vscode.ExtensionContext) {
  const supportedLanguages: LanguageId[] = ["c", "java"];

  // 1. Register Hover Provider
  const hoverProvider = vscode.languages.registerHoverProvider(
    supportedLanguages,
    {
      provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
      ): vscode.ProviderResult<vscode.Hover> {
        const range = document.getWordRangeAtPosition(position);
        if (!range) return null;

        const word = document.getText(range);
        if (generatedConstantsInfo.has(word)) {
          const lineText = document.lineAt(position.line).text;
          const isDeclaration =
            lineText.includes(word) &&
            (lineText.includes("final") || lineText.trim().startsWith("const"));

          if (isDeclaration) {
            const info = generatedConstantsInfo.get(word);
            if (info && info.locations.length > 0) {
              const hoverContent = new vscode.MarkdownString();
              hoverContent.isTrusted = true;
              hoverContent.appendMarkdown(
                `**\`${word}\` is used on the following lines:**\n\n`
              );

              const usageLinks = info.locations
                .map((loc) => {
                  const finalLineNumber = loc.line + 1 + info.linesInserted;
                  const args = [
                    info.uri,
                    {
                      selection: new vscode.Range(
                        finalLineNumber - 1, 0,
                        finalLineNumber - 1, 0
                      ),
                    },
                  ];
                  const commandUri = vscode.Uri.parse(
                    `command:vscode.open?${encodeURIComponent(JSON.stringify(args))}`
                  );
                  return `* [Line ${finalLineNumber}: \`${loc.text.trim()}\`](${commandUri})`;
                })
                .join("\n");

              hoverContent.appendMarkdown(usageLinks);
              return new vscode.Hover(hoverContent, range);
            }
          }
        }
        return null;
      },
    }
  );
  context.subscriptions.push(hoverProvider);

  // 2. Register Main Command
  const disposable = vscode.commands.registerCommand(
    "extension.convertToConstants",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const document = editor.document;
      const langId = document.languageId;

      if (langId !== "c" && langId !== "java") {
        vscode.window.showInformationMessage(
          `This command is only available for C and Java files.`
        );
        return;
      }
      const languageId: LanguageId = langId; // Type assertion

      generatedConstantsInfo.clear();

      const text = document.getText();
      const numberOccurrences = new Map<string, NumberOccurrence[]>();
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
          position: position,
          text: line.text.trim(),
        });
      }

      if (numberOccurrences.size === 0) {
        vscode.window.showInformationMessage(
          "No magic numbers found to convert."
        );
        return;
      }

      const uniqueNumbers = Array.from(numberOccurrences.keys());
      const constantMappings = new Map<string, ConstantData>();

      for (const number of uniqueNumbers) {
        const firstOccurrence = numberOccurrences.get(number)![0];
        const suggestedName = suggestConstantName(
          firstOccurrence.text,
          number,
          languageId
        );
        const contextualComment = generateContextualComment(
          firstOccurrence.text,
          number,
          languageId
        );

        const constantName = await vscode.window.showInputBox({
          prompt: `Enter constant name for "${number}"`,
          value: suggestedName,
          placeHolder: "e.g., MAX_RETRIES, PI_VALUE",
          validateInput: (text) =>
            /^[A-Z_][A-Z0-9_]*$/.test(text)
              ? null
              : "Invalid constant name (use UPPER_SNAKE_CASE)",
        });

        if (constantName) {
          const constantType = inferDataType(number);
          constantMappings.set(number, {
            name: constantName,
            comment: contextualComment,
            type: constantType,
          });
        } else {
          vscode.window.showInformationMessage("Number conversion cancelled.");
          return;
        }
      }

      if (constantMappings.size > 0) {
        const linesInsertedCount = constantMappings.size * 2;
        constantMappings.forEach((data, numberStr) => {
          const occurrences = numberOccurrences.get(numberStr)!;
          const locations: CodeLocation[] = occurrences.map((occ) => ({
            line: occ.position.line,
            text: occ.text,
          }));
          generatedConstantsInfo.set(data.name, {
            locations,
            uri: document.uri,
            linesInserted: linesInsertedCount,
          });
        });

        await editor.edit((editBuilder) => {
          // Replace all number occurrences with the new constant name
          const edits: { range: vscode.Range; text: string }[] = [];
          constantMappings.forEach((data, num) => {
            const occurrencesToReplace = numberOccurrences.get(num)!;
            occurrencesToReplace.forEach((occ) => {
              const startPos = occ.position;
              const endPos = startPos.translate(0, num.length);
              edits.push({
                range: new vscode.Range(startPos, endPos),
                text: data.name,
              });
            });
          });

          edits
            .sort((a, b) => b.range.start.compareTo(a.range.start))
            .forEach((edit) => editBuilder.replace(edit.range, edit.text));

          // Insert the constant declarations at the top of the file
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
          editBuilder.insert(
            new vscode.Position(0, 0),
            constantsDeclarations + "\n"
          );
        });

        vscode.window.showInformationMessage(
          "Successfully converted numbers to constants!"
        );
      }
    }
  );

  context.subscriptions.push(disposable);
}