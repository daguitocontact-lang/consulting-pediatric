/**
 * Markdown imported as text.
 *
 * The template assistant's prompt is a .md file rather than a string constant
 * for the same reason the legacy keeps it in `pkg/prompts/`: it is edited far
 * more often than the code around it, and a 180-line prompt inside a template
 * literal is unreviewable. Bun's `with { type: 'text' }` loads it at import.
 */
declare module '*.md' {
  const content: string
  export default content
}
