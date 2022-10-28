import { NodeHttpHandler } from "@aws-sdk/node-http-handler";
import { serializeError } from "serialize-error";

import {
  CreateGuideCommand,
  CreateGuideInput,
  GuidesClient,
  GuidesClientConfig,
  ListGuidesCommand,
  PublishGuideCommand,
  ResourceConflictException
} from "@stedi/sdk-client-guides";

import { DEFAULT_SDK_CLIENT_PROPS } from "../lib/constants.js";

let _guidesClient: GuidesClient;

export const guidesClient = () => {
  if (_guidesClient === undefined) {
    const config: GuidesClientConfig = {
      ...DEFAULT_SDK_CLIENT_PROPS,
      endpoint: "https://guides.us.stedi.com/2022-03-09",
      maxAttempts: 5,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 5_000,
      }),
    };

    _guidesClient = new GuidesClient(config);
  }

  return _guidesClient;
};

export const parseGuideId = (fullGuideId: string): string => {
  return fullGuideId.split("_")[1];
};

export const ensureGuideExists = async (namespace: string, guide: CreateGuideInput): Promise<string> => {
  if (!guide.name) {
    throw new Error(`[${namespace}] Guide input must include "name" property`);
  }

  try {
    const fullGuideId = await createGuide(namespace, guide);
    const parsedGuideId = parseGuideId(fullGuideId);
    console.log(`[${namespace}] Guide created: ${parsedGuideId}`);
    return parsedGuideId;
  } catch (e) {
    if (!(e instanceof ResourceConflictException)) {
      // re-throw all errors except resource conflict
      throw new Error(`[${namespace}] Error creating guide: ${JSON.stringify(serializeError(e))}`);
    }

    console.log(`[${namespace}] Guide creation skipped (guide already exists)`);
    const foundGuideId = await findGuideIdByName(namespace, guide.name);
    return parseGuideId(foundGuideId);
  }
};

const createGuide = async (namespace: string, guide: CreateGuideInput): Promise<string> => {
  const createGuideResponse = await guidesClient().send(new CreateGuideCommand(guide));

  if (!createGuideResponse.id)
    throw new Error(`[${namespace}] Error creating guide (id not found in response)`);

  if (!createGuideResponse.publishedAt) {
    await publishGuide(createGuideResponse.id);
  }

  return createGuideResponse.id;
};

const publishGuide = async (guideId: string): Promise<any> => {
  return await guidesClient().send(new PublishGuideCommand({
    id: guideId,
  }));
};

const findGuideIdByName = async (namespace: string, guideName: string, pageToken?: string): Promise<string> => {
  const guidesList = await guidesClient().send(new ListGuidesCommand({
    nextPageToken: pageToken,
  }));

  const foundGuide = guidesList.items?.find((guide=> guide.name === guideName));

  if (!foundGuide?.id && !guidesList.nextPageToken) {
    throw new Error(`[${namespace}] Failed to look up existing guide by name: ${guideName}`);
  }

  return foundGuide?.id || await findGuideIdByName(namespace, guideName, guidesList.nextPageToken);
};
