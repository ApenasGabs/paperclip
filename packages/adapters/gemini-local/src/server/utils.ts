export function firstNonEmptyLine(text: string): string {
    return (
        text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find(Boolean) ?? ""
    );
}

const BENIGN_GEMINI_STDERR_LINE_RES: readonly RegExp[] = [
    /^\[PaperclipMaintenance\]/i,
    /^\[paperclip\]/i,
    /^YOLO mode is enabled\b/i,
    /^Loaded cached credentials/i,
];

const EXPLICIT_ERROR_LINE_RES: readonly RegExp[] = [
    /^(?:error|fatal|exception)\s*:/i,
    /\bRESOURCE_EXHAUSTED\b/i,
    /\bIndividual quota reached\b/i,
    /\bQuota exceeded\b/i,
    /\bAll accounts in pool are currently exhausted\b/i,
    /\bAGY_ERROR\b/i,
];

export function isBenignGeminiStderrLine(line: string): boolean {
    return BENIGN_GEMINI_STDERR_LINE_RES.some((re) => re.test(line));
}

export function firstMeaningfulStderrLine(text: string): string {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    // 1. Prioritize explicit fatal/quota/service errors if present anywhere in stderr
    const explicitError = lines.find((line) =>
        EXPLICIT_ERROR_LINE_RES.some((re) => re.test(line))
    );
    if (explicitError) return explicitError;

    // 2. Otherwise find the first line that is not benign maintenance/startup logging
    const meaningful = lines.find((line) => !isBenignGeminiStderrLine(line));
    return meaningful ?? firstNonEmptyLine(text);
}
