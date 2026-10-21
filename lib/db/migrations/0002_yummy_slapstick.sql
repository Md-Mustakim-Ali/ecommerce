DROP INDEX "roles_global_slug_key";--> statement-breakpoint
CREATE UNIQUE INDEX "roles_global_scope_slug_key" ON "roles" USING btree ("scope","slug") WHERE "roles"."store_id" is null;