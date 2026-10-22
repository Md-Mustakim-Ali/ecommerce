import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/lib/db";
import { platformSettings } from "@/lib/db/schema";

/**
 * Platform settings, read once per request.
 *
 * `cache()` dedupes within a request, so checkout reading the shipping rule and
 * the order builder reading the commission rate cost one query between them.
 *
 * The defaults here are the same as the column defaults. They only apply if
 * the row is missing entirely, which should not happen — but a checkout that
 * throws because a settings row was never inserted is a worse failure than one
 * that charges the documented default.
 */

export type PlatformSettings = {
  commissionBps: number;
  freeShippingThresholdCents: number;
  flatShippingCents: number;
  maintenanceNotice: string | null;
};

export const DEFAULTS: PlatformSettings = {
  commissionBps: 1000,
  freeShippingThresholdCents: 7500,
  flatShippingCents: 599,
  maintenanceNotice: null,
};

export const getPlatformSettings = cache(
  async (): Promise<PlatformSettings> => {
    const [row] = await db
      .select({
        commissionBps: platformSettings.commissionBps,
        freeShippingThresholdCents: platformSettings.freeShippingThresholdCents,
        flatShippingCents: platformSettings.flatShippingCents,
        maintenanceNotice: platformSettings.maintenanceNotice,
      })
      .from(platformSettings)
      .where(eq(platformSettings.id, "default"))
      .limit(1);

    return row ?? DEFAULTS;
  },
);

/**
 * Shipping for an order subtotal, using the current settings.
 *
 * Takes the settings rather than reading them, so it stays pure and the caller
 * decides when the read happens — checkout already has them loaded.
 */
export function shippingFor(
  subtotalCents: number,
  settings: Pick<
    PlatformSettings,
    "freeShippingThresholdCents" | "flatShippingCents"
  >,
): number {
  return subtotalCents >= settings.freeShippingThresholdCents
    ? 0
    : settings.flatShippingCents;
}
