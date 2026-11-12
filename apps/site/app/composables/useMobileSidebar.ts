/** 顶栏与默认布局共用的移动端导航状态，按 Nuxt 请求隔离。 */
export function useMobileSidebar() {
  return useState<boolean>("mobile-sidebar-open", () => false);
}
