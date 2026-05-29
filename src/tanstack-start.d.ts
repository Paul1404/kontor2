// Loads the @tanstack/react-start module augmentation that adds the `server`
// option (server route handlers) to file routes. Without this reference the
// augmentation in @tanstack/start-client-core is never pulled into the TS
// program, and `createFileRoute(...)({ server: { handlers } })` fails to type.
/// <reference types="@tanstack/react-start" />
