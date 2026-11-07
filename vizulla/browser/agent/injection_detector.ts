// Injection detector (P5-AI-05, C2): ADVISORY. It scans untrusted observations for
// instruction-like text and can pause the agent to ask the user. It can never
// allow anything the Policy Enforcer would block.
const PATTERNS: [RegExp, string][] = [
  [/\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|all)\b.{0,30}\b(instructions?|rules?|prompts?)\b/i, 'override-instructions'],
  [/\b(you are now|act as|new instructions?|system prompt|developer mode)\b/i, 'role-change'],
  [/\b(send|post|forward|upload|exfiltrate|email)\b.{0,60}\b(password|cookies?|token|credit card|api key|personal data|your data)\b/i, 'exfiltration'],
  [/\b(navigate|go|visit|open)\b.{0,20}\b(to )?https?:\/\/[^\s]+/i, 'redirect-request'],
  [/<\/?(system|assistant|tool)>/i, 'fake-delimiters'],
  [/\b(ignorez|oubliez)\b.{0,40}\b(instructions|consignes)\b/i, 'override-instructions-fr'],
];

export interface Detection {
  suspected: boolean;
  signals: string[];
  excerpt: string;
}

export function detectInjection(text: string): Detection {
  const signals: string[] = [];
  let excerpt = '';
  for (const [re, name] of PATTERNS) {
    const m = re.exec(text);
    if (m) {
      signals.push(name);
      excerpt ||= text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).trim();
    }
  }
  return { suspected: signals.length > 0, signals, excerpt };
}
