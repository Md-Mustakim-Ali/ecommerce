/**
 * The permission vocabulary.
 *
 * This list is the whole vocabulary. Roles are user-created bundles of these
 * keys; permissions themselves are never user-created. If people could invent
 * permissions they would create ones no code path checks, and a role would
 * quietly grant nothing.
 *
 * VERSIONED: bump PERMISSION_VOCABULARY_VERSION whenever a key is added,
 * removed or renamed. Stored roles keep the version they were written against
 * so a migration can find roles referencing a key that no longer exists.
 *
 * Removing a key is a breaking change. Prefer adding a new one and leaving the
 * old key unused until every stored role has been migrated off it.
 */

export const PERMISSION_VOCABULARY_VERSION = 3;

export type PermissionScope = "store" | "platform";

export type PermissionDef = {
  key: string;
  scope: PermissionScope;
  group: string;
  label: string;
  description: string;
  /**
   * Marks a permission that lets its holder change who can do what. These are
   * the ones that make privilege escalation possible, so the role editor warns
   * on them and the ceiling check treats them no differently — but a human
   * reviewing an audit log needs them to stand out.
   */
  sensitive?: boolean;
};

// ---------------------------------------------------------------------------
// Store scope — granted by a store owner to their staff, always for one store.
// ---------------------------------------------------------------------------

const STORE_PERMISSIONS = [
  // Catalog
  {
    key: "product.view",
    group: "Catalog",
    label: "View products",
    description: "See the store's products, including drafts.",
  },
  {
    key: "product.create",
    group: "Catalog",
    label: "Create products",
    description: "Add a new product as a draft.",
  },
  {
    key: "product.update",
    group: "Catalog",
    label: "Edit products",
    description: "Change title, description, images and attributes.",
  },
  {
    key: "product.publish",
    group: "Catalog",
    label: "Publish products",
    description: "Move a product from draft to live on the storefront.",
  },
  {
    key: "product.archive",
    group: "Catalog",
    label: "Archive products",
    description: "Remove a product from the storefront without deleting it.",
  },
  {
    key: "product.delete",
    group: "Catalog",
    label: "Delete products",
    description: "Permanently delete a product that has never been ordered.",
  },
  {
    key: "variant.manage",
    group: "Catalog",
    label: "Manage variants",
    description: "Add, edit and remove variants, options and SKUs.",
  },
  {
    key: "inventory.update",
    group: "Catalog",
    label: "Update stock",
    description: "Change stock levels without editing anything else.",
  },
  {
    key: "brand.propose",
    group: "Catalog",
    label: "Propose brands",
    description: "Submit a new brand for platform review.",
  },
  {
    key: "tag.propose",
    group: "Catalog",
    label: "Propose tags",
    description: "Submit a new tag for platform review.",
  },

  // Orders and fulfilment
  {
    key: "order.view",
    group: "Orders",
    label: "View orders",
    description: "See orders placed with this store.",
  },
  {
    key: "order.accept",
    group: "Orders",
    label: "Accept orders",
    description: "Confirm an order and commit to fulfilling it.",
  },
  {
    key: "order.ship",
    group: "Orders",
    label: "Ship orders",
    description: "Mark shipped and add carrier and tracking details.",
  },
  {
    key: "order.cancel",
    group: "Orders",
    label: "Cancel orders",
    description: "Cancel an order before it ships.",
  },
  {
    key: "order.refund",
    group: "Orders",
    label: "Request refunds",
    description: "Start a refund. Money only moves once an admin approves.",
  },
  {
    key: "order.payment.view",
    group: "Orders",
    label: "See payment details",
    description:
      "See how an order was paid: the amounts received, the number the money came from, and each transaction id.",
  },
  {
    key: "order.note",
    group: "Orders",
    label: "Add order notes",
    description: "Write internal notes on an order.",
  },
  {
    key: "customer.contact",
    group: "Orders",
    label: "Contact buyers",
    description: "Message a buyer about their order.",
  },

  // Storefront
  {
    key: "store.profile.update",
    group: "Storefront",
    label: "Edit store profile",
    description: "Change store name, description and support contacts.",
  },
  {
    key: "store.theme.update",
    group: "Storefront",
    label: "Edit store appearance",
    description: "Change logo, banner, accent colour and layout preset.",
  },

  // Media
  //
  // Separate from store.profile.update, which is what gated this before and
  // was far too broad: connecting an account binds a real person's Google
  // Drive and YouTube channel to the store, and that is not the same power as
  // renaming the shop.
  {
    key: "media.connection.view",
    group: "Media",
    label: "View media connections",
    description:
      "See which Google accounts and Cloud projects the store's photos and videos use, and how much upload quota is left.",
  },
  {
    key: "media.connection.manage",
    group: "Media",
    label: "Manage media connections",
    description:
      "Add Cloud projects, connect and disconnect Google accounts. Disconnecting an account hides every photo and video stored on it.",
  },

  // Staff
  {
    key: "member.view",
    group: "Staff",
    label: "View staff",
    description: "See who has access to this store.",
  },
  {
    key: "member.invite",
    group: "Staff",
    label: "Invite staff",
    description: "Invite someone to join this store.",
    sensitive: true,
  },
  {
    key: "member.remove",
    group: "Staff",
    label: "Remove staff",
    description: "Revoke someone's access to this store.",
    sensitive: true,
  },
  // Deliberately separate from role.* — being able to put someone in an
  // existing role is a much smaller power than being able to define what that
  // role can do.
  {
    key: "member.assign_role",
    group: "Staff",
    label: "Assign roles",
    description: "Put a staff member into an existing role.",
    sensitive: true,
  },
  {
    key: "role.view",
    group: "Staff",
    label: "View roles",
    description: "See the store's roles and their permissions.",
  },
  {
    key: "role.create",
    group: "Staff",
    label: "Create roles",
    description: "Define a new role and choose its permissions.",
    sensitive: true,
  },
  {
    key: "role.update",
    group: "Staff",
    label: "Edit roles",
    description: "Change what an existing role can do.",
    sensitive: true,
  },
  {
    key: "role.delete",
    group: "Staff",
    label: "Delete roles",
    description: "Remove a role that has no members.",
    sensitive: true,
  },

  // Money — read-only at store scope. Money never moves from here.
  {
    key: "payout.view",
    group: "Finance",
    label: "View payouts",
    description: "See payout history and the current balance.",
  },
  {
    key: "ledger.view",
    group: "Finance",
    label: "View ledger",
    description: "See individual sale, commission and refund entries.",
  },
  {
    key: "report.sales.view",
    group: "Finance",
    label: "View sales reports",
    description: "See revenue, order volume and product performance.",
  },

  {
    key: "attribute.propose",
    group: "Catalog",
    label: "Propose attributes",
    description: "Submit a new attribute or option value for platform review.",
  },

  // Content
  {
    key: "page.view",
    group: "Content",
    label: "View pages",
    description: "See this store's custom pages, including drafts.",
  },
  {
    key: "page.create",
    group: "Content",
    label: "Create pages",
    description: "Build a new page for this store.",
  },
  {
    key: "page.update",
    group: "Content",
    label: "Edit pages",
    description: "Change the content and blocks on a page.",
  },
  {
    key: "page.publish",
    group: "Content",
    label: "Publish pages",
    description: "Make a page visible to buyers, or take it down.",
  },
  {
    key: "page.delete",
    group: "Content",
    label: "Delete pages",
    description: "Permanently remove a page.",
  },
  {
    key: "placement.manage",
    group: "Content",
    label: "Manage banners and offers",
    description:
      "Create offer banners and cards, and choose which pages they appear on.",
  },

  // Audit
  {
    key: "audit.view",
    group: "Audit",
    label: "View audit log",
    description: "See who changed roles, staff and store settings.",
  },
] as const satisfies readonly Omit<PermissionDef, "scope">[];

// ---------------------------------------------------------------------------
// Platform scope — your own staff. Never granted to a seller.
// ---------------------------------------------------------------------------

const PLATFORM_PERMISSIONS = [
  {
    key: "platform.store.view",
    group: "Stores",
    label: "View all stores",
    description: "See every store on the platform.",
  },
  {
    key: "platform.store.approve",
    group: "Stores",
    label: "Approve stores",
    description: "Move a store from pending to active.",
  },
  {
    key: "platform.store.suspend",
    group: "Stores",
    label: "Suspend stores",
    description: "Take a store offline.",
    sensitive: true,
  },

  {
    key: "platform.brand.review",
    group: "Moderation",
    label: "Review brands",
    description: "Approve, reject or merge proposed brands.",
  },
  {
    key: "platform.tag.review",
    group: "Moderation",
    label: "Review tags",
    description: "Approve, reject or merge proposed tags.",
  },
  {
    key: "platform.category.manage",
    group: "Moderation",
    label: "Manage categories",
    description: "Edit the global category tree.",
  },
  {
    key: "platform.product.moderate",
    group: "Moderation",
    label: "Moderate products",
    description: "Take down a product that breaks policy.",
  },
  {
    key: "platform.review.moderate",
    group: "Moderation",
    label: "Moderate reviews",
    description: "Flag or remove a buyer review.",
  },

  {
    key: "platform.attribute.review",
    group: "Moderation",
    label: "Review attributes",
    description: "Approve, reject or merge proposed attributes and values.",
  },
  {
    key: "platform.page.manage",
    group: "Content",
    label: "Manage site pages",
    description: "Create and edit pages that are not tied to a store.",
  },
  {
    key: "platform.placement.manage",
    group: "Content",
    label: "Manage site-wide banners",
    description:
      "Create banners and offers, and target them at any page or group of pages.",
    sensitive: true,
  },
  {
    key: "platform.order.view",
    group: "Orders",
    label: "View all orders",
    description: "See any order across any store.",
  },
  {
    key: "platform.refund.approve",
    group: "Orders",
    label: "Approve refunds",
    description: "Approve a refund so money actually moves.",
    sensitive: true,
  },

  {
    key: "platform.ledger.view",
    group: "Finance",
    label: "View all ledgers",
    description: "See ledger entries for every store.",
  },
  {
    key: "platform.payout.initiate",
    group: "Finance",
    label: "Initiate payouts",
    description: "Send money to a seller.",
    sensitive: true,
  },
  {
    key: "platform.finance.report",
    group: "Finance",
    label: "View platform finance",
    description: "See GMV, commission and reconciliation.",
  },

  {
    key: "platform.user.view",
    group: "Users",
    label: "View users",
    description: "Look up any user account.",
  },
  {
    key: "platform.user.suspend",
    group: "Users",
    label: "Suspend users",
    description: "Disable a user account.",
    sensitive: true,
  },
  {
    key: "platform.role.manage",
    group: "Users",
    label: "Manage platform roles",
    description: "Create and edit platform-scope roles.",
    sensitive: true,
  },

  {
    key: "platform.settings.manage",
    group: "System",
    label: "Manage settings",
    description: "Change commission rates and platform configuration.",
    sensitive: true,
  },
  {
    key: "platform.audit.view",
    group: "System",
    label: "View platform audit log",
    description: "See every privileged action taken by staff.",
  },
] as const satisfies readonly Omit<PermissionDef, "scope">[];

export const PERMISSIONS: readonly PermissionDef[] = [
  ...STORE_PERMISSIONS.map((p) => ({ ...p, scope: "store" as const })),
  ...PLATFORM_PERMISSIONS.map((p) => ({ ...p, scope: "platform" as const })),
];

export type StorePermission = (typeof STORE_PERMISSIONS)[number]["key"];
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number]["key"];
export type Permission = StorePermission | PlatformPermission;

const STORE_KEYS = new Set<string>(STORE_PERMISSIONS.map((p) => p.key));
const PLATFORM_KEYS = new Set<string>(PLATFORM_PERMISSIONS.map((p) => p.key));
const ALL_KEYS = new Set<string>([...STORE_KEYS, ...PLATFORM_KEYS]);

export const STORE_PERMISSION_KEYS = Object.freeze([
  ...STORE_KEYS,
]) as readonly StorePermission[];

export const PLATFORM_PERMISSION_KEYS = Object.freeze([
  ...PLATFORM_KEYS,
]) as readonly PlatformPermission[];

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && ALL_KEYS.has(value);
}

export function isStorePermission(value: unknown): value is StorePermission {
  return typeof value === "string" && STORE_KEYS.has(value);
}

export function isPlatformPermission(
  value: unknown,
): value is PlatformPermission {
  return typeof value === "string" && PLATFORM_KEYS.has(value);
}

export function permissionsForScope(scope: PermissionScope) {
  return PERMISSIONS.filter((p) => p.scope === scope);
}

/** Grouped for rendering the role editor. Order follows the definitions above. */
export function permissionGroups(scope: PermissionScope) {
  const groups = new Map<string, PermissionDef[]>();
  for (const permission of permissionsForScope(scope)) {
    const list = groups.get(permission.group) ?? [];
    list.push(permission);
    groups.set(permission.group, list);
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }));
}

/**
 * Actions reserved to the store owner and to nobody else.
 *
 * These are deliberately NOT permission keys. Anything expressible in the
 * vocabulary can be put in a custom role, and these must never be — an owner
 * who could delegate "change payout destination" could be socially engineered
 * into handing over their revenue. `stores.owner_id` is the only thing that
 * authorises them, and it cannot be granted, copied or assumed.
 */
export const OWNER_ONLY_ACTIONS = [
  "store.transfer_ownership",
  "store.delete",
  "store.billing.update",
  "store.payout_destination.update",
] as const;

export type OwnerOnlyAction = (typeof OWNER_ONLY_ACTIONS)[number];

/** Ceiling on custom roles per store, so complexity cannot run away. */
export const MAX_CUSTOM_ROLES_PER_STORE = 20;
