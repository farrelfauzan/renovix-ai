import type { NavigationGroup } from "./navigation-group";

/**
 * The groups with only the items these permissions show (RNX-312a): an item without a permission is shown to
 * every admin. Visibility only: a direct URL still reaches the route, and the API's AccessGuard decides.
 */
export function selectVisibleNavigation(groups: readonly NavigationGroup[], permissions: readonly string[]): readonly NavigationGroup[] {
  return groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.permission === undefined || permissions.includes(item.permission)),
  }));
}
