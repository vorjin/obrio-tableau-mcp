import { Config, getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import {
  getOverridableConfig,
  isOverridableVariable,
  OverridableConfig,
} from '../overridableConfig.js';
import { RestApiArgs, useRestApi } from '../restApiInstance.js';
import { RestApi } from '../sdks/tableau/restApi.js';
import { McpSiteSettings, McpSiteSettingsResult } from '../sdks/tableau/types/mcpSiteSettings.js';
import { isAxiosError } from './axios.js';
import { ExpiringMap } from './expiringMap.js';
import { getExceptionMessage } from './getExceptionMessage.js';
import { getSiteLuidFromAccessToken } from './getSiteLuidFromAccessToken.js';
import { DistributiveOmit } from './types.js';

type SiteNameOrSiteId = string;

const MCP_SITE_SETTINGS_MIN_REST_API_VERSION = '3.29';
// A genuine fetch failure caches empty settings only briefly, so a transient error can't silently
// drop a site-configured content restriction for the full check interval.
const MCP_SITE_SETTINGS_NEGATIVE_CACHE_MS = 60 * 1000;
let mcpSiteSettingsCache: ExpiringMap<SiteNameOrSiteId, McpSiteSettings>;

async function getMcpSiteSettings({
  restApiArgs,
}: {
  restApiArgs: RestApiArgs;
}): Promise<McpSiteSettings | undefined> {
  const { config, tableauAuthInfo } = restApiArgs;
  if (
    !config.enableMcpSiteSettings ||
    !RestApi.versionIsAtLeast(MCP_SITE_SETTINGS_MIN_REST_API_VERSION)
  ) {
    return;
  }

  if (!mcpSiteSettingsCache) {
    mcpSiteSettingsCache = new ExpiringMap<SiteNameOrSiteId, McpSiteSettings>({
      defaultExpirationTimeMs: config.mcpSiteSettingsCheckIntervalInMinutes * 60 * 1000,
    });
  }

  const cacheKey = config.siteName || getSiteLuidFromAccessToken(tableauAuthInfo) || 'Default';
  if (!cacheKey) {
    throw new Error('Could not determine site ID/name');
  }

  const cachedSettings = mcpSiteSettingsCache.get(cacheKey);
  if (cachedSettings) {
    return cachedSettings;
  }

  const mcpSiteSettings: McpSiteSettings = {};
  // A 403 means the feature is disabled for this site — a settled, benign state safe to cache for the
  // full interval. Any other failure is treated as transient: proceed without overrides so the request
  // still succeeds, but cache the empty fallback only briefly so a configured restriction isn't silently
  // dropped for the whole interval.
  let fetchFailed = false;
  try {
    const result: McpSiteSettingsResult = await useRestApi({
      ...restApiArgs,
      jwtScopes: ['tableau:mcp_site_settings:read'],
      callback: async (restApi) =>
        await restApi.mcpSettingsMethods.getMcpSiteSettings({ siteId: restApi.siteId }),
    });
    for (const setting of result.settings) {
      if (isOverridableVariable(setting.key)) {
        mcpSiteSettings[setting.key] = setting.value;
      }
    }
  } catch (error) {
    const featureDisabled = isAxiosError(error) && error.response?.status === 403;
    fetchFailed = !featureDisabled;
    log({
      message: `Failed to get MCP settings for site; continuing without site overrides: ${getExceptionMessage(error)}`,
      level: 'warning',
      logger: 'mcp-site-settings',
      data: error,
    });
  }

  if (!config.allowSitesToConfigureRequestOverrides) {
    delete mcpSiteSettings.ALLOWED_REQUEST_OVERRIDES;
  }

  mcpSiteSettingsCache.set(
    cacheKey,
    mcpSiteSettings,
    fetchFailed ? MCP_SITE_SETTINGS_NEGATIVE_CACHE_MS : undefined,
  );
  return mcpSiteSettings;
}

// Make "config" and "signal" optional
type GetConfigWithOverridesArgs = DistributiveOmit<RestApiArgs, 'config' | 'signal'> &
  Partial<{ config: Config; signal: AbortSignal }>;

export async function getConfigWithOverrides({
  restApiArgs,
  requestOverrides,
}: {
  restApiArgs: GetConfigWithOverridesArgs;
  requestOverrides: Record<string, string> | undefined;
}): Promise<OverridableConfig> {
  const config = restApiArgs.config ?? getConfig();
  const signal = restApiArgs.signal ?? AbortSignal.timeout(config.maxRequestTimeoutMs);

  const siteOverrides = await getMcpSiteSettings({
    restApiArgs: { ...restApiArgs, config, signal },
  });

  return getOverridableConfig(siteOverrides, requestOverrides);
}
