import type { WorklogPlatform } from "@/lib/dashboard/types";
import type {
  WorklogActionType,
  WorklogDraft,
  WorklogScope,
} from "@/lib/dashboard/worklog";

/**
 * Raw change event structure representing Google Ads `change_event` API stream.
 * In Google Ads API: SELECT change_event.change_date_time, change_event.change_resource_type,
 * change_event.user_email, change_event.client_type, change_event.old_resource, change_event.new_resource
 * FROM change_event WHERE change_event.change_date_time >= '...'
 */
export interface GoogleChangeEvent {
  id: string;
  platform: "google";
  changeDateTime: string; // ISO 8601
  userEmail: string;
  changeResourceType: "CAMPAIGN_BUDGET" | "CAMPAIGN" | "AD_GROUP" | "AD_GROUP_CRITERION" | "AD_GROUP_AD";
  changeType: "ADDED" | "UPDATED" | "REMOVED";
  entityName: string;
  clientType: "GOOGLE_ADS_WEB_CLIENT" | "BULK_UPLOAD" | "API" | "AUTOMATED_RULE";
  details: string;
}

/**
 * Raw change event structure representing Meta Graph API `/{ad_account_id}/activities` stream.
 * In Meta Graph API: GET /act_{id}/activities?fields=event_type,event_time,extra_data,actor_name,translated_event_type
 */
export interface MetaActivityEvent {
  id: string;
  platform: "meta";
  eventTime: string; // ISO 8601
  actorName: string;
  eventType:
    | "update_ad_set_budget"
    | "update_ad_run_status"
    | "add_keywords_targeting"
    | "update_ad_creative"
    | "update_bid_strategy"
    | "create_campaign";
  entityName: string;
  translatedEventType: string;
  details: string;
}

export interface TikTokChangeEvent {
  id: string;
  platform: "tiktok";
  eventTime: string; // ISO 8601
  actorName: string;
  eventType: string;
  entityName: string;
  details: string;
}

export interface Ga4ChangeEvent {
  id: string;
  platform: "ga4";
  eventTime: string; // ISO 8601
  actorName: string;
  eventType: string;
  entityName: string;
  details: string;
}

export interface BingChangeEvent {
  id: string;
  platform: "bing";
  eventTime: string; // ISO 8601
  actorName: string;
  eventType: string;
  entityName: string;
  details: string;
}

export type PlatformChangeEvent =
  | GoogleChangeEvent
  | MetaActivityEvent
  | TikTokChangeEvent
  | Ga4ChangeEvent
  | BingChangeEvent;

/**
 * Smart engine that maps raw Google/Meta platform change events into structured Worklog Drafts.
 */
export function mapChangeEventToWorklogDraft(
  event: PlatformChangeEvent,
  accountSlug: string,
): WorklogDraft {
  const dateStr = event.platform === "google"
    ? event.changeDateTime.split("T")[0]
    : event.eventTime.split("T")[0];

  if (event.platform === "google") {
    let scope: WorklogScope = "campaign";
    let actionType: WorklogActionType = "Other";
    let reasonOrHypothesis = "Automated sync from Google Ads Change History API.";

    switch (event.changeResourceType) {
      case "CAMPAIGN_BUDGET":
        scope = "campaign";
        actionType = "Budget change";
        reasonOrHypothesis = "Daily budget allocation adjusted to scale top-converting search themes.";
        break;
      case "AD_GROUP_CRITERION":
        scope = "other";
        actionType = "Keyword or negative";
        reasonOrHypothesis = "Keyword list pruned to block non-commercial queries and avoid budget leakage.";
        break;
      case "AD_GROUP_AD":
        scope = "creative";
        actionType = "Creative rotation";
        reasonOrHypothesis = "Ad copy headline/description updated for higher ad strength and CTR.";
        break;
      case "CAMPAIGN":
        scope = "campaign";
        actionType = event.changeType === "REMOVED" ? "Campaign paused" : "Structure change";
        reasonOrHypothesis = "Campaign status/structure reconfigured based on weekly performance audit.";
        break;
      default:
        scope = "campaign";
        actionType = "Structure change";
    }

    return {
      accountSlug,
      occurredOn: dateStr,
      platform: "google",
      scope,
      entityName: event.entityName,
      actionType,
      actionSummary: `[Google Ads Auto-Sync] ${event.details} (by ${event.userEmail})`,
      reasonOrHypothesis,
      status: "needs-review",
    };
  }

  // Meta Ads Activity Mapping
  let scope: WorklogScope = "campaign";
  let actionType: WorklogActionType = "Other";
  let reasonOrHypothesis = "Automated sync from Meta Ads Graph API Activity Log.";

  switch (event.eventType) {
    case "update_ad_set_budget":
      scope = "campaign";
      actionType = "Budget change";
      reasonOrHypothesis = "Ad set budget increased for scaling high-ROAS creative angles.";
      break;
    case "update_ad_creative":
      scope = "creative";
      actionType = "Creative rotation";
      reasonOrHypothesis = "Refreshed fatigued creative hook with new video UGC iteration.";
      break;
    case "update_ad_run_status":
      scope = "creative";
      actionType = "Campaign paused";
      reasonOrHypothesis = "Paused ad creative exceeding target CPA guardrail.";
      break;
    case "add_keywords_targeting":
      scope = "other";
      actionType = "Audience change";
      reasonOrHypothesis = "Updated audience interest and lookalike targeting parameters.";
      break;
    case "update_bid_strategy":
      scope = "campaign";
      actionType = "Bid or target change";
      reasonOrHypothesis = "Adjusted cost cap / target ROAS bidding constraints.";
      break;
    default:
      scope = "campaign";
      actionType = "Structure change";
  }

  if (event.platform === "tiktok") {
    return {
      accountSlug,
      occurredOn: dateStr,
      platform: "tiktok",
      scope: "campaign",
      entityName: event.entityName,
      actionType: "Bid or target change",
      actionSummary: `[TikTok Ads Auto-Sync] ${event.details} (by ${event.actorName})`,
      reasonOrHypothesis: "Optimization performed on TikTok Ads Manager campaign pacing.",
      status: "needs-review",
    };
  }

  if (event.platform === "ga4") {
    return {
      accountSlug,
      occurredOn: dateStr,
      platform: "ga4",
      scope: "other",
      entityName: event.entityName,
      actionType: "Tracking or measurement fix",
      actionSummary: `[GA4 Auto-Sync] ${event.details} (by ${event.actorName})`,
      reasonOrHypothesis: "Conversion definition or tracking configuration adjusted in GA4 property.",
      status: "needs-review",
    };
  }

  if (event.platform === "bing") {
    return {
      accountSlug,
      occurredOn: dateStr,
      platform: "bing",
      scope: "campaign",
      entityName: event.entityName,
      actionType: "Keyword or negative",
      actionSummary: `[Microsoft Advertising Auto-Sync] ${event.details} (by ${event.actorName})`,
      reasonOrHypothesis: "Syndicated search adjustments synced from Microsoft Advertising.",
      status: "needs-review",
    };
  }

  return {
    accountSlug,
    occurredOn: dateStr,
    platform: "meta",
    scope,
    entityName: event.entityName,
    actionType,
    actionSummary: `[Meta Ads Auto-Sync] ${event.translatedEventType}: ${event.details} (by ${event.actorName})`,
    reasonOrHypothesis,
    status: "needs-review",
  };
}

/**
 * Returns recent platform change history events (mock connector fixture stream).
 */
export function getMockPlatformChangeHistory(
  accountSlug: string,
  platform: WorklogPlatform | "all" | string,
): PlatformChangeEvent[] {
  const googleEvents: GoogleChangeEvent[] = [
    {
      id: "g-chg-101",
      platform: "google",
      changeDateTime: "2026-08-14T11:30:00Z",
      userEmail: "owner@satulayar.example",
      changeResourceType: "CAMPAIGN_BUDGET",
      changeType: "UPDATED",
      entityName: "ID | Search | Cafe Supplies Tier 1",
      clientType: "GOOGLE_ADS_WEB_CLIENT",
      details: "Daily budget increased from $45.00 to $65.00 (+44%)",
    },
    {
      id: "g-chg-102",
      platform: "google",
      changeDateTime: "2026-08-12T14:15:00Z",
      userEmail: "owner@satulayar.example",
      changeResourceType: "AD_GROUP_CRITERION",
      changeType: "ADDED",
      entityName: "ID | Search | Arabica Coffee Trade",
      clientType: "GOOGLE_ADS_WEB_CLIENT",
      details: "Added 6 negative phrase keywords (e.g. \"free recipes\", \"single sachet amazon\")",
    },
    {
      id: "g-chg-103",
      platform: "google",
      changeDateTime: "2026-08-09T09:45:00Z",
      userEmail: "ops@satulayar.example",
      changeResourceType: "AD_GROUP_AD",
      changeType: "ADDED",
      entityName: "ID | Search | Artisan Coffee",
      clientType: "GOOGLE_ADS_WEB_CLIENT",
      details: "Added Responsive Search Ad with new headline \"Direct Trade Arabica Indonesia\"",
    },
  ];

  const metaEvents: MetaActivityEvent[] = [
    {
      id: "m-act-201",
      platform: "meta",
      eventTime: "2026-08-15T16:20:00Z",
      actorName: "Owner (PPC Lead)",
      eventType: "update_ad_set_budget",
      entityName: "Meta | ID Prospecting | Video Hooks Tier 1",
      translatedEventType: "Ad Set Budget Adjustment",
      details: "Budget scaled from $40/day to $60/day following ROAS surge",
    },
    {
      id: "m-act-202",
      platform: "meta",
      eventTime: "2026-08-13T10:10:00Z",
      actorName: "Owner (PPC Lead)",
      eventType: "update_ad_run_status",
      entityName: "Ad #104: Static Drip Bag Pack",
      translatedEventType: "Ad Creative Paused",
      details: "Paused due to high frequency (3.8x) and CTR decay below 1.0%",
    },
    {
      id: "m-act-203",
      platform: "meta",
      eventTime: "2026-08-10T13:45:00Z",
      actorName: "PPC Operations",
      eventType: "update_ad_creative",
      entityName: "Ad #108: Reels Studio Unboxing UGC",
      translatedEventType: "New Creative Uploaded",
      details: "Launched new 15s UGC video with hook \"How to brew a better pour-over at home\"",
    },
  ];

  const tiktokEvents: TikTokChangeEvent[] = [
    {
      id: "tt-chg-301",
      platform: "tiktok",
      eventTime: "2026-08-16T12:00:00Z",
      actorName: "Owner (PPC Lead)",
      eventType: "spark_ad_budget",
      entityName: "TikTok | ID TopView & Spark UGC",
      details: "Scaled Spark Ad budget from $30/day to $50/day following viral hook",
    },
  ];

  const ga4Events: Ga4ChangeEvent[] = [
    {
      id: "ga4-chg-401",
      platform: "ga4",
      eventTime: "2026-08-15T09:15:00Z",
      actorName: "Owner (Analytics)",
      eventType: "conversion_event_mark",
      entityName: "GA4 | Key Event: subscription_purchase",
      details: "Marked custom subscription purchase event as primary key conversion for bidding",
    },
  ];

  const bingEvents: BingChangeEvent[] = [
    {
      id: "bing-chg-501",
      platform: "bing",
      eventTime: "2026-08-11T15:30:00Z",
      actorName: "PPC Operations",
      eventType: "import_campaign",
      entityName: "Microsoft Ads | Search | Cafe Supplies SG",
      details: "Synced updated negative keyword lists from Google Ads campaign",
    },
  ];

  if (platform === "google") return googleEvents;
  if (platform === "meta") return metaEvents;
  if (platform === "tiktok") return tiktokEvents;
  if (platform === "ga4") return ga4Events;
  if (platform === "bing") return bingEvents;
  return [...googleEvents, ...metaEvents, ...tiktokEvents, ...ga4Events, ...bingEvents];
}
