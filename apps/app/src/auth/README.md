# Desktop auth client (placeholder)

Not implemented. This directory reserves the location for the desktop
app's login flow — authenticates against the website's online
PocketBase (see `apps/website/src/license/`) to validate a license.

Canvas data (images, videos, layout) continues to live in the embedded
PocketBase (`apps/app/src/lib/pb.ts`); nothing local moves online.

Out of scope for the current monorepo restructure (scope A).
