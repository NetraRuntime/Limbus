# CLAUDE.md — NetraRT

## About Netra

Netra is a platform to make vision AI as accessible as text AI has become.

Today, running a vision model or a vision-language model at the edge is still hard: you fight with model formats, inference runtimes, hardware quirks, and latency budgets that never quite fit. Most developers give up and send frames to the cloud, which breaks privacy, costs money, and adds latency that kills real-time use cases.

Netra is built to change that. Born out of **SAM3.c** (a pure C port of Segment Anything 3) and **Kolosal AI** (an open-source C++ LLM platform that runs on any GPU), Netra brings the same obsession with performance and accessibility to the vision world.

The goal is simple: anyone, anywhere, on any device, should be able to run state-of-the-art vision models and vision-LLMs. Not just developers with a few lines of code, but also agentic coding tools that can integrate it natively, ordinary people who want to run it out of the box, and students and scientists who need it to generate synthetic datasets, annotate their data, or build OCR pipelines without fighting infrastructure.

Optimized for the edge from day one, so your camera, your drone, your robot, your phone, and your Raspberry Pi all become places where vision AI just works.

## About NetraRT

NetraRT is the user-facing surface of Netra: an infinite-canvas desktop app (Tauri) and a public website. This monorepo hosts both apps along with shared design-system and tooling packages. See `README.md` for layout, prerequisites, and run scripts.

---

# React Clean Code Rules

Guidance for writing React code that meets the standards of projects like Excalidraw, Cal.com, Bulletproof React, and Radix UI. Follow these rules when generating, reviewing, or refactoring React code.

## Core Philosophy

- **Colocation over centralization.** Keep code close to where it is used. Only lift things up when they are genuinely shared.
- **Explicit over implicit.** Prefer clarity over cleverness. A junior dev should understand the code on first read.
- **Boring over novel.** Use well-known patterns. Custom abstractions need to earn their place.
- **Delete over add.** The best code is the code you did not write. Question every new file, dependency, and abstraction.

## Project Structure

Organize by **feature**, not by file type. Avoid top-level `components/`, `hooks/`, `utils/` folders that grow unboundedly.

```
src/
  app/                    # Routes, providers, app-level config
  features/
    auth/
      api/                # Data fetching for this feature
      components/         # Feature-specific UI
      hooks/
      types/
      utils/
      index.ts            # Public API of the feature
    dashboard/
    billing/
  components/             # Truly shared, generic UI primitives only
  hooks/                  # Truly shared hooks only
  lib/                    # Third-party integrations, clients
  utils/                  # Pure, generic helpers
  types/                  # Shared types
```

**Rules:**
- A feature folder is a black box. Other features import only from its `index.ts`.
- Never import across features directly (`features/auth/components/LoginForm` from inside `features/billing` is forbidden). If two features need the same thing, it graduates to `components/` or `lib/`.
- Shared folders (`components/`, `hooks/`) are for things used in **three or more places**. Before that, keep it local.

## Components

### Size and Shape
- Components should fit on one screen (roughly under 150 lines). If longer, extract subcomponents or hooks.
- One component per file. File name matches the component name in PascalCase: `UserCard.tsx` exports `UserCard`.
- Default export for the component, named exports for everything else (types, helpers, subcomponents).

### Writing Components
- Use function declarations, not arrow functions, for top-level components. Arrow functions are fine for small inline subcomponents.
- Destructure props in the signature. Give props an explicit type, never inline object types for anything non-trivial.
- No `React.FC`. Type props directly.

```tsx
type UserCardProps = {
  user: User;
  onEdit?: (id: string) => void;
};

export function UserCard({ user, onEdit }: UserCardProps) {
  // ...
}
```

### Prop Design
- Prefer specific props over generic `config` or `options` objects.
- Booleans are fine, but consider a discriminated union when flags become mutually exclusive (`variant: 'primary' | 'secondary'` beats `isPrimary + isSecondary`).
- Avoid prop drilling beyond two levels. Use composition (`children`, render props) or context before passing props through middlemen.
- Make illegal states unrepresentable. If `isLoading` is true, `data` should not also be present in the type.

### Composition
- Favor composition over configuration. A flexible `<Card>` with `<Card.Header>`, `<Card.Body>` slots beats a `<Card>` with 15 props.
- Use `children` liberally. Components that accept children are more reusable than those that do not.
- Headless patterns (Radix, Headless UI) are the gold standard for reusable interactive components.

## State Management

### Hierarchy of State (use in this order)
1. **URL state** — for anything shareable, bookmarkable, or navigable (filters, tabs, modals that should survive refresh).
2. **Local component state** (`useState`, `useReducer`) — default choice.
3. **Lifted state** — lift only as high as needed, no higher.
4. **Context** — for genuinely global concerns (theme, auth, locale). Not for avoiding prop drilling in feature code.
5. **Server state library** (TanStack Query, SWR) — for anything from the network. Never store server data in `useState`.
6. **Global client state** (Zustand, Jotai, Redux) — last resort, for complex client-only state shared across unrelated parts of the tree.

### Rules
- Do not put server data in global state. Server cache libraries already solve this.
- `useEffect` is not a state synchronizer. If you are using an effect to "sync" one state to another, derive it during render instead.
- Derived values go in variables during render, not in `useState` + `useEffect`.
- `useMemo` and `useCallback` are not free. Use them for measured performance problems or referential stability required by dependencies, not reflexively.

## Hooks

- Custom hooks start with `use`. One hook per file when non-trivial.
- A hook should do one thing. `useUser()` fetches a user. `useUserForm()` manages a user form. Do not merge these.
- Hooks encapsulate logic, not UI. If a hook returns JSX, it should probably be a component.
- Follow the Rules of Hooks religiously. Never call hooks conditionally.
- If a hook has more than 3-4 return values, return an object, not a tuple.

## TypeScript

- Strict mode on. No exceptions. `strict: true` in `tsconfig.json`.
- No `any`. Use `unknown` when the type is genuinely unknown and narrow it.
- Prefer `type` over `interface` for props and most data shapes. Use `interface` only when you need declaration merging.
- Do not type things TypeScript can infer. Let it infer return types for internal functions; annotate public API boundaries explicitly.
- Use discriminated unions for state machines: `{ status: 'idle' } | { status: 'loading' } | { status: 'success'; data: T } | { status: 'error'; error: Error }`.
- `as` casts are a code smell. Use type guards or schema validators (Zod) at boundaries.

## Data Fetching

- All network data goes through a server state library (TanStack Query is the default).
- Define query keys in a structured way: `['users', userId, 'posts']`, not random strings.
- Colocate query and mutation hooks with the feature that owns them (`features/users/api/useUser.ts`).
- Validate external data with a schema (Zod) at the fetch boundary. Do not trust API responses.
- Handle loading, error, and empty states explicitly for every query. Never render as if data is always present.

## Styling

- Pick one system per project and stick to it. Common choices: Tailwind CSS, CSS Modules, vanilla-extract, or a CSS-in-JS library.
- For Tailwind: use `clsx` or `cn` helper for conditional classes. Do not build class strings with template literals.
- Extract repeated class combinations into components, not into `@apply` chains or shared class strings.
- Design tokens (colors, spacing, radii) come from a single source — a theme config or CSS variables. Never hardcode hex values or pixel sizes in components.

## Forms

- Use `react-hook-form` for non-trivial forms. It is the community standard for performance and ergonomics.
- Validation with Zod (or similar schema library), shared between client and server when possible.
- Controlled inputs are fine for small forms. Uncontrolled + `react-hook-form` for anything larger.

## Error Handling

- Every async operation can fail. Handle it.
- Use error boundaries at meaningful tree locations (route level, feature level), not just at the app root.
- Distinguish between expected errors (validation, 404) and unexpected errors (network down, bug). Show the user something useful for the former; log and show a generic fallback for the latter.
- Do not swallow errors silently. An empty `catch {}` is a bug.

## Accessibility

- Semantic HTML first. A `<button>` is a button; do not use `<div onClick>`.
- Every interactive element is keyboard-reachable and has a visible focus state.
- Labels on every form control. `aria-label` only when a visible label is impossible.
- Respect `prefers-reduced-motion` for animations.
- Color is never the only signal. Pair it with text or icons.
- Use a headless library (Radix, React Aria) for complex widgets (modals, menus, comboboxes). Do not hand-roll these.

## Performance

- Measure before optimizing. Do not premature-optimize with `memo`, `useMemo`, `useCallback` everywhere.
- Code-split at the route level by default. Lazy-load heavy components (editors, charts, maps) that are not immediately visible.
- Virtualize lists over ~100 items (`@tanstack/react-virtual`).
- Keep bundle size honest. Audit dependencies. A 200KB date library for one `format()` call is not acceptable.

## Testing

- Test behavior from the user's perspective. React Testing Library, not Enzyme-style internals.
- Prefer a few integration tests over many unit tests for components.
- Mock at the network boundary (MSW), not at the module level.
- Every bug fix gets a regression test.
- Do not test implementation details. If a refactor breaks passing tests without changing behavior, the tests were wrong.

## Naming

- Components: `PascalCase` (`UserProfile`).
- Hooks: `camelCase` starting with `use` (`useUserProfile`).
- Utilities and variables: `camelCase`.
- Constants: `SCREAMING_SNAKE_CASE` only for genuine module-level constants.
- Types: `PascalCase`. No `I` prefix for interfaces. No `T` prefix for types.
- Event handlers: `handleX` inside a component, `onX` as a prop name (`onClick`, not `onClickHandler`).
- Booleans: `is`, `has`, `should`, `can` (`isOpen`, `hasError`).

## Code Quality Guardrails

- ESLint with `eslint-plugin-react`, `eslint-plugin-react-hooks`, `@typescript-eslint`, and `eslint-plugin-jsx-a11y`. Errors fail CI.
- Prettier for formatting. No debates, no custom rules beyond the defaults.
- No commented-out code. Delete it; git remembers.
- No `console.log` in committed code. Use a logger or remove it.
- Every dependency added is justified. Prefer the platform and existing deps.

## What to Avoid

- Barrel files (`index.ts` that re-exports everything) at deep levels — they hurt tree-shaking and create import cycles. Use them only at feature boundaries.
- `useEffect` for anything except synchronizing with external systems (subscriptions, DOM APIs, non-React libraries).
- Premature abstraction. Three similar components are not automatically one component. Wait until the pattern is clear.
- God components and god hooks. If a file is managing auth, routing, fetching, and rendering, split it.
- Mixing concerns. A component either fetches data or renders UI — ideally not both in a complex way. Use container/presentation separation when it adds clarity.
- Inline anonymous functions in props when referential stability matters (memoized children, effect dependencies).

## Commit and PR Hygiene

- Small PRs. Under ~400 lines of diff when possible.
- Conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`) or a similar structured style.
- Each PR does one thing. Refactors and features do not ship together.
- PR description explains the *why*, not just the *what*. The diff shows the what.

## When in Doubt

Ask: "Would a reviewer at Excalidraw, Cal.com, or Vercel accept this code?" If the answer is uncertain, simplify until it is clearly yes.
