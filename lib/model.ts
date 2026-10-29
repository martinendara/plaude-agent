import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";

// One line to switch providers. Groq is primary; Gemini is the fallback.
const PROVIDER: "groq" | "google" = "groq";

const GROQ_MODEL_ID = "openai/gpt-oss-120b";
const GOOGLE_MODEL_ID = "gemini-3.6-flash";

// Low reasoning keeps the Groq free tier under its 8k tokens/minute limit.
export const MODEL_PROVIDER_OPTIONS =
  PROVIDER === "groq"
    ? { groq: { reasoningEffort: "low" as const } }
    : undefined;

export async function getModel() {
  "use step";

  return PROVIDER === "groq"
    ? groq(GROQ_MODEL_ID)
    : google(GOOGLE_MODEL_ID);
}
