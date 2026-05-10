export interface MenuLeaf {
  label: string;
  href: string;
}

export interface MenuGroup {
  label: string;
  children: MenuLeaf[];
}

export type MenuEntry = MenuLeaf | MenuGroup;

export const isMenuGroup = (entry: MenuEntry): entry is MenuGroup => (
  (entry as MenuGroup).children !== undefined
);

export const menuItems: MenuEntry[] = [
  { label: 'Home', href: '/' },
  { label: 'About', href: '/about' },
  { label: 'Demo', href: '/demo' },
  { label: 'Self-host', href: '/self-hosting' },
  { label: 'API', href: '/developers' },
  { label: 'Integrations', href: '/integrations' },
];
