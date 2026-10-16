import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";

/**
 * better-auth mount (spec: dashboard-auth). Dashboard-only surface: lives
 * under /api/auth/*, never /api/v1/* — the public widget endpoints and their
 * guard are a separate security model and stay cookie-free.
 */
export const { GET, POST } = toNextJsHandler((request) => getAuth().handler(request));
