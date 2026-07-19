import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ViewNotAllowedError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { isRateLimitError } from '../../../sdks/tableau/tableauApiError.js';
import { WebMcpServer } from '../../../server.web.js';
import { retry } from '../../../utils/retry.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  viewId: z.string(),
  viewFilters: z
    .record(z.string())
    .optional()
    .describe('Optional map of view filter field names to values.'),
};

export const getGetViewDataTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const getViewDataTool = new WebTool({
    server,
    name: 'get-view-data',
    description: [
      "Retrieves comma-separated value (CSV) data for the specified view in a Tableau workbook, including the user's filters.",
      'Requires the view LUID from the content URL (not the published view id).',
      'For custom views, use the tool to get custom view data by custom view id instead.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title: 'Get View Data',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ viewId, viewFilters }, extra): Promise<CallToolResult> => {
      return await getViewDataTool.logAndExecute<string>({
        extra,
        args: { viewId, viewFilters },
        callback: async () => {
          const isViewAllowedResult = await resourceAccessChecker.isViewAllowed({
            viewId,
            extra,
          });

          if (!isViewAllowedResult.allowed) {
            return new ViewNotAllowedError(isViewAllowedResult.message).toErr();
          }

          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: getViewDataTool.requiredApiScopes,
              callback: async (restApi) => {
                // Retry rate-limited requests on the same session with backoff, so a transient
                // rate limit doesn't surface as a hard failure.
                return await retry(
                  () =>
                    restApi.viewsMethods.queryViewData({
                      viewId,
                      siteId: restApi.siteId,
                      viewFilters,
                    }),
                  { retryIf: isRateLimitError, delayFactorMs: 1000 },
                );
              },
            }),
          );
        },
        constrainSuccessResult: (viewData) => {
          return {
            type: 'success',
            result: viewData,
          };
        },
      });
    },
  });

  return getViewDataTool;
};
