/**
 * Multi-provider LLM abstraction (Gemini / Groq / OpenAI).
 * Implemented in S3 (master plan §6.6.6).
 *
 * Zero-Cost Track uses Gemini as primary and Groq for consensus;
 * OpenAI is held in reserve for fallback only.
 */

export type Provider = "gemini" | "groq" | "openai";

export interface CompletionInput {
  provider: Provider;
  system: string;
  user: string;
  schema: object;
  schemaName: string;
  temperature?: number;
  seed?: number;
}

export interface CompletionOutput<T> {
  data: T;
  provider: Provider;
  model: string;
  usage: { in: number; out: number };
}

export async function complete<T>(_input: CompletionInput): Promise<CompletionOutput<T>> {
  throw new Error("complete() not yet implemented — see S3");
}

export async function completeWithFallback<T>(_input: CompletionInput): Promise<CompletionOutput<T>> {
  throw new Error("completeWithFallback() not yet implemented — see S3");
}
