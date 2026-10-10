export type ChannelCapability = "manage_channels" | "edit_channel_terms" | "override_accommodation" | "verify_collection" | "confirm_commission" | "record_settlement" | "reconcile_settlement";
export type ChannelCapabilities = Record<ChannelCapability, boolean>;
// Demo capabilities; replace through the provider when authentication is introduced.
export const demoChannelCapabilities: ChannelCapabilities = { manage_channels: true, edit_channel_terms: true, override_accommodation: true, verify_collection: true, confirm_commission: true, record_settlement: true, reconcile_settlement: true };
export function can(capabilities: ChannelCapabilities, capability: ChannelCapability) { return capabilities[capability] === true; }
