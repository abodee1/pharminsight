// Admin-only server function middleware. Builds on requireSupabaseAuth and then
// verifies the caller has the 'admin' role via the SECURITY DEFINER has_role() RPC.
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "./auth-middleware";

export const requireAdminAuth = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (error) {
      throw new Error("Forbidden: role check failed");
    }
    if (!data) {
      throw new Error("Forbidden: admin role required");
    }
    return next();
  });
