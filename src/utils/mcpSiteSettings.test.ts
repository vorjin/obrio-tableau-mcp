import { WebMcpServer } from '../server.web';
import { stubDefaultEnvVars } from '../testShared';
import { getConfigWithOverrides } from './mcpSiteSettings';

const mocks = vi.hoisted(() => ({
  mockGetMcpSiteSettings: vi.fn(),
}));

vi.mock('../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      mcpSettingsMethods: {
        getMcpSiteSettings: mocks.mockGetMcpSiteSettings,
      },
    }),
  ),
}));

describe('mcpSiteSettings', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should not override any settings when enableMcpSiteSettings is false', async () => {
    vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'false');
    const config = await getConfigWithOverrides({
      restApiArgs: {
        server: new WebMcpServer(),
        tableauAuthInfo: undefined,
        disableLogging: true,
      },
      requestOverrides: undefined,
    });

    expect(config.includeTools).toEqual([]);
    expect(config.excludeTools).toEqual([]);
    expect(config.boundedContext).toEqual({
      projectIds: null,
      datasourceIds: null,
      workbookIds: null,
      viewIds: null,
      tags: null,
    });
    expect(config.getMaxResultLimit('query-datasource')).toEqual(null);
    expect(config.disableQueryDatasourceValidationRequests).toEqual(false);
    expect(config.disableMetadataApiRequests).toEqual(false);

    expect(mocks.mockGetMcpSiteSettings).not.toHaveBeenCalled();
  });

  it('should override settings when enableMcpSiteSettings is true', async () => {
    vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'true');
    mocks.mockGetMcpSiteSettings.mockResolvedValue({
      settings: [
        { key: 'INCLUDE_TOOLS', value: 'list-views,list-datasources' },
        { key: 'INCLUDE_PROJECT_IDS', value: 'project1,project2' },
        { key: 'INCLUDE_DATASOURCE_IDS', value: 'datasource1,datasource2' },
        { key: 'INCLUDE_WORKBOOK_IDS', value: 'workbook1,workbook2' },
        { key: 'INCLUDE_VIEW_IDS', value: 'view1,view2' },
        { key: 'INCLUDE_TAGS', value: 'tag1,tag2' },
        { key: 'MAX_RESULT_LIMIT', value: '100' },
        { key: 'MAX_RESULT_LIMITS', value: 'query-datasource:100,list-datasources:20' },
        { key: 'DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS', value: 'true' },
        { key: 'DISABLE_METADATA_API_REQUESTS', value: 'true' },
      ],
    });

    let config = await getConfigWithOverrides({
      restApiArgs: {
        server: new WebMcpServer(),
        tableauAuthInfo: undefined,
        disableLogging: true,
      },
      requestOverrides: undefined,
    });

    expect(config.includeTools).toEqual(['list-views', 'list-datasources']);
    expect(config.excludeTools).toEqual([]);
    expect(config.boundedContext).toEqual({
      projectIds: new Set(['project1', 'project2']),
      datasourceIds: new Set(['datasource1', 'datasource2']),
      workbookIds: new Set(['workbook1', 'workbook2']),
      viewIds: new Set(['view1', 'view2']),
      tags: new Set(['tag1', 'tag2']),
    });
    expect(config.getMaxResultLimit('query-datasource')).toEqual(100);
    expect(config.getMaxResultLimit('list-datasources')).toEqual(20);
    expect(config.disableQueryDatasourceValidationRequests).toEqual(true);
    expect(config.disableMetadataApiRequests).toEqual(true);

    expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(1);

    // Verify cache behavior
    config = await getConfigWithOverrides({
      restApiArgs: {
        server: new WebMcpServer(),
        tableauAuthInfo: undefined,
        disableLogging: true,
      },
      requestOverrides: undefined,
    });

    expect(config.includeTools).toEqual(['list-views', 'list-datasources']);
    expect(config.excludeTools).toEqual([]);
    expect(config.boundedContext).toEqual({
      projectIds: new Set(['project1', 'project2']),
      datasourceIds: new Set(['datasource1', 'datasource2']),
      workbookIds: new Set(['workbook1', 'workbook2']),
      viewIds: new Set(['view1', 'view2']),
      tags: new Set(['tag1', 'tag2']),
    });
    expect(config.getMaxResultLimit('query-datasource')).toEqual(100);
    expect(config.getMaxResultLimit('list-datasources')).toEqual(20);
    expect(config.disableQueryDatasourceValidationRequests).toEqual(true);
    expect(config.disableMetadataApiRequests).toEqual(true);

    expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(1);
  });

  it('falls back to empty overrides when the settings fetch fails, without throwing', async () => {
    vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'true');
    // A distinct site name keys a fresh cache entry so this case isn't served the earlier override.
    vi.stubEnv('SITE_NAME', 'fail-open-site');
    mocks.mockGetMcpSiteSettings.mockRejectedValue({
      isAxiosError: true,
      response: { status: 500, data: {} },
    });

    const config = await getConfigWithOverrides({
      restApiArgs: {
        server: new WebMcpServer(),
        tableauAuthInfo: undefined,
        disableLogging: true,
      },
      requestOverrides: undefined,
    });

    expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalled();
    expect(config.includeTools).toEqual([]);
    expect(config.excludeTools).toEqual([]);
    expect(config.boundedContext).toEqual({
      projectIds: null,
      datasourceIds: null,
      workbookIds: null,
      viewIds: null,
      tags: null,
    });
  });

  it('caches an empty fallback only briefly on a genuine error, then re-fetches', async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'true');
      vi.stubEnv('SITE_NAME', 'negative-cache-site');
      // This file's beforeEach doesn't reset mocks, so isolate this case's call count and behavior.
      mocks.mockGetMcpSiteSettings.mockReset();

      const restApiArgs = {
        server: new WebMcpServer(),
        tableauAuthInfo: undefined,
        disableLogging: true as const,
      };

      mocks.mockGetMcpSiteSettings.mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 500, data: {} },
      });
      await getConfigWithOverrides({ restApiArgs, requestOverrides: undefined });
      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(1);

      // Within the short negative-cache window: served from cache, no re-fetch.
      await getConfigWithOverrides({ restApiArgs, requestOverrides: undefined });
      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(1);

      // After the negative-cache window (but well within the full interval): the empty fallback has
      // expired, so a configured restriction is picked back up on the next fetch.
      vi.advanceTimersByTime(61 * 1000);
      mocks.mockGetMcpSiteSettings.mockResolvedValueOnce({
        settings: [{ key: 'INCLUDE_VIEW_IDS', value: 'view1' }],
      });
      const config = await getConfigWithOverrides({ restApiArgs, requestOverrides: undefined });

      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(2);
      expect(config.boundedContext.viewIds).toEqual(new Set(['view1']));
    } finally {
      vi.useRealTimers();
    }
  });
});
