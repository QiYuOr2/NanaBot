export default defineNuxtRouteMiddleware(async (to) => {
  const requestFetch = useRequestFetch();
  const session = await requestFetch<{ configured: boolean; authenticated: boolean }>(
    "/api/auth/session",
  );
  if (to.path === "/login") {
    if (session.authenticated) return navigateTo("/");
    return;
  }
  if (!session.authenticated) {
    return navigateTo({ path: "/login", query: { redirect: to.fullPath } }, { replace: true });
  }
});
