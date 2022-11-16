import { TextEncoder } from "util";

import { NodeHttpHandler } from "@aws-sdk/node-http-handler";
import {
  CreateFunctionCommand,
  CreateFunctionCommandOutput,
  DeleteFunctionCommand,
  DeleteFunctionCommandOutput,
  FunctionsClient,
  FunctionsClientConfig,
  InvokeFunctionCommand,
  UpdateFunctionCommand,
  UpdateFunctionCommandOutput,
} from "@stedi/sdk-client-functions";

import { DEFAULT_SDK_CLIENT_PROPS } from "../lib/constants.js";

let _functionsClient: FunctionsClient;

export const functionClient = (): FunctionsClient => {
  if (_functionsClient === undefined) {
    const config: FunctionsClientConfig = {
      ...DEFAULT_SDK_CLIENT_PROPS,
      maxAttempts: 5,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 1_000,
      }),
    };

    _functionsClient = new FunctionsClient(config);
  }

  return _functionsClient;
};

export const invokeFunction = async (
  functionName: string,
  input?: any
): Promise<string> => {
  const requestPayload = input
    ? new TextEncoder().encode(JSON.stringify(input))
    : undefined;

  const result = await functionClient().send(
    new InvokeFunctionCommand({
      functionName,
      requestPayload,
    })
  );
  if (!result?.responsePayload) {
    throw new Error("no response payload received");
  }

  return Buffer.from(result.responsePayload).toString("utf-8");
};

export const createFunction = async (
  functionName: string,
  functionPackage: Uint8Array,
  environmentVariables?: {
    [key: string]: string;
  }
): Promise<CreateFunctionCommandOutput> => {
  return functionClient().send(
    new CreateFunctionCommand({
      functionName,
      package: functionPackage,
      environmentVariables,
      timeout: 900,
    })
  );
};

export const updateFunction = async (
  functionName: string,
  functionPackage: Uint8Array,
  environmentVariables?: {
    [key: string]: string;
  }
): Promise<UpdateFunctionCommandOutput> => {
  return functionClient().send(
    new UpdateFunctionCommand({
      functionName,
      package: functionPackage,
      environmentVariables,
      timeout: 900,
    })
  );
};

export const deleteFunction = async (
  functionName: string
): Promise<DeleteFunctionCommandOutput> => {
  return functionClient().send(
    new DeleteFunctionCommand({
      functionName,
    })
  );
};
