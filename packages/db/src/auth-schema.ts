import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organizations } from "./schema";

/**
 * Authentication tables (spec: dashboard-auth). The SHAPE of these tables is
 * owned by better-auth + its organization plugin — every field mirrors the
 * installed version's model definitions (including `accounts.issuer`, new in
 * 1.7). On a better-auth upgrade, diff this file against the library's schema
 * before migrating; never redesign it by hand.
 *
 * They migrate through the same drizzle-kit journal as ./schema.ts so the
 * compose migrate service stays a single `pnpm db:migrate`.
 *
 * D12 exception (like rate_limits): no org_id here. Identity precedes tenancy
 * — `members` is the org link, and org-scoped queries key off the session's
 * active organization, not off these rows.
 *
 * The org plugin maps onto the EXISTING `organizations` table (model
 * `organization` → schema key `organizations` via the adapter's `usePlural`),
 * which is why there is no organization table in this file.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  ...timestamps,
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Organization plugin: the org this session operates on (always the instance's single org). */
    activeOrganizationId: text("active_organization_id"),
    ...timestamps,
  },
  (t) => [uniqueIndex("sessions_token_idx").on(t.token), index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    /** Provider issuer discriminator (better-auth 1.7); "local:credential" for email+password. */
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** scrypt hash for credential accounts — never selected by app code. */
    password: text("password"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("accounts_issuer_account_idx").on(t.issuer, t.accountId),
    index("accounts_user_idx").on(t.userId),
  ],
);

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

export const members = pgTable(
  "members",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** owner | admin | editor | viewer — the D12 baseline, defined in apps/web lib/auth/permissions. */
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("members_org_idx").on(t.organizationId),
    index("members_user_idx").on(t.userId),
    uniqueIndex("members_org_user_idx").on(t.organizationId, t.userId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invitations_org_idx").on(t.organizationId)],
);

/**
 * Relations for drizzle's relational queries (db.query.*.findFirst with
 * `with`). Key names are the SINGULAR model name of the joined table — the
 * shape better-auth's adapter derives under `usePlural` — so these also serve
 * the adapter's join mode. That mode is OFF in apps/web (it threw inside
 * drizzle's query builder on session lookups; see lib/auth.ts) but the
 * relations stand: they are correct for direct use and for revisiting joins
 * on an upgrade.
 */
export const usersRelations = relations(users, ({ many }) => ({
  session: many(sessions),
  account: many(accounts),
  member: many(members),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const membersRelations = relations(members, ({ one }) => ({
  user: one(users, { fields: [members.userId], references: [users.id] }),
  organization: one(organizations, {
    fields: [members.organizationId],
    references: [organizations.id],
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  user: one(users, { fields: [invitations.inviterId], references: [users.id] }),
  organization: one(organizations, {
    fields: [invitations.organizationId],
    references: [organizations.id],
  }),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  member: many(members),
  invitation: many(invitations),
}));
