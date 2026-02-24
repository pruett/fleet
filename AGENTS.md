# Tooling
- use `bun` instead of `node` and all of its variants (e.g. `bunx` instead of `npx`)

# Frontend
Every visible UI element should be backed by a named component — either a shadcn/ui primitive, an AI SDK Elements component, or a project-level component built following the same patterns. **A `<div>` with a long string of Tailwind classes in a render function is a code smell.** It signals missing abstraction.

When you encounter bare markup during implementation, apply this checklist:

1. **Does shadcn/ui already have a component for this?** Use it. (`Card`, `Badge`, `Table`, `Alert`, `Separator`, `ScrollArea`, etc.)
2. **Does AI SDK Elements have a component for this?** Use it. (`Conversation`, `ConversationContent`, `ConversationScrollButton`, etc.)
3. **Neither library covers it?** Create a project-level component in `src/components/` following shadcn/ui conventions:
   - Accept `className` prop, merge with `cn()`
   - Use CSS variables for theme tokens
   - Use `cva` (class-variance-authority) for variant definitions
   - Keep the component focused on a single responsibility
   - Co-locate the component with its variants (e.g., `ConversationBubble` with `variant="user" | "assistant"`)

This applies to layout containers too — a two-column split should be a `<PanelLayout>`, not a bare `<div className="flex ...">`. The goal is that reading a render function tells you *what* the UI is, not *how* it's styled.
