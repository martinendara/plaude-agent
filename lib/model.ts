import { google } from "@ai-sdk/google";

// The only place where the model is chosen. Swapping providers is one line.
const MODEL_ID = "gemini-3.6-flash";

export async function getModel() {
  "use step";

  return google(MODEL_ID);
}
