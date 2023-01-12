import { format } from "date-fns";
import { serializeError } from "serialize-error";

import { MapDocumentCommand, MappingsClient } from "@stedi/sdk-client-mappings";
import { PutObjectCommand, PutObjectCommandInput, } from "@stedi/sdk-client-buckets";

import { bucketClient } from "../../../lib/buckets.js";
import { translateJsonToEdi } from "../../../lib/translateV3.js";
import {
  failedExecution,
  generateExecutionId,
  markExecutionAsSuccessful,
  recordNewExecution,
} from "../../../lib/execution.js";
import { getEnvVarNameForResource, requiredEnvVar } from "../../../lib/environment.js";
import { DEFAULT_SDK_CLIENT_PROPS } from "../../../lib/constants.js";
import { EdiMetadata } from "./types";
import { generateControlNumber } from "../../../lib/generateControlNumber";
import { lookupFunctionalIdentifierCode } from "../../../lib/lookupFunctionalIdentifierCode";
import { As2Client, StartFileTransferCommand } from "@stedi/sdk-client-as2";

const mappingsClient = new MappingsClient(DEFAULT_SDK_CLIENT_PROPS);
const as2Client = new As2Client(DEFAULT_SDK_CLIENT_PROPS);

// Buckets client is shared across handler and execution tracking logic
const bucketsClient = bucketClient();

export const handler = async (event: any): Promise<Record<string, any>> => {
  const executionId = generateExecutionId(event);
  console.log("starting", JSON.stringify({ input: event, executionId }));

  try {
    await recordNewExecution(executionId, event);

    const ediMetadata = EdiMetadata.parse(event.ediMetadata);
    const resourceIdKey = `X12-${ediMetadata.release}-${ediMetadata.transactionSet}`;

    // Fail fast if required env vars are missing
    const guideEnvVarName = getEnvVarNameForResource("guide", resourceIdKey);
    const mappingEnvVarName = getEnvVarNameForResource("mapping", resourceIdKey);
    const guideId = requiredEnvVar(guideEnvVarName);
    const mappingId = requiredEnvVar(mappingEnvVarName);

    // extract envelope metadata needed for control number generation
    const isaSendingPartnerId = `${ediMetadata.interchangeHeader.senderQualifier}-${ediMetadata.interchangeHeader.senderId}`;
    const isaReceivingPartnerId = `${ediMetadata.interchangeHeader.receiverQualifier}-${ediMetadata.interchangeHeader.receiverId}`;
    const usageIndicatorCode = ediMetadata.interchangeHeader.usageIndicatorCode;
    const gsSendingPartnerId = ediMetadata?.groupHeader?.applicationSenderCode || ediMetadata.interchangeHeader.senderId;
    const gsReceivingPartnerId = ediMetadata?.groupHeader?.applicationReceiverCode || ediMetadata.interchangeHeader.receiverId;

    const documentDate = new Date();

    // resolve the functional identifier code for the transaction set
    const functionalIdentifierCode = lookupFunctionalIdentifierCode(ediMetadata.transactionSet);

    // Generate control numbers for sender/receiver pair
    const isaControlNumber = await generateControlNumber({
      segment: "ISA",
      usageIndicatorCode,
      sendingPartnerId: isaSendingPartnerId,
      receivingPartnerId: isaReceivingPartnerId,
    });
    const gsControlNumber = await generateControlNumber({
      segment: "GS",
      usageIndicatorCode,
      sendingPartnerId: gsSendingPartnerId,
      receivingPartnerId: gsReceivingPartnerId,
    });

    // Configure envelope data (interchange control header and functional group header) to combine with mapping result
    const envelope = {
      interchangeHeader: {
        ...ediMetadata.interchangeHeader,
        date: format(documentDate, "yyyy-MM-dd"),
        time: format(documentDate, "HH:mm"),
        controlNumber: isaControlNumber,
      },
      groupHeader: {
        functionalIdentifierCode,
        applicationSenderCode: gsSendingPartnerId,
        applicationReceiverCode: gsReceivingPartnerId,
        date: format(documentDate, "yyyy-MM-dd"),
        time: format(documentDate, "HH:mm:ss"),
        controlNumber: gsControlNumber,
      },
    };

    // Execute mapping to transform API JSON input to Guide schema-based JSON
    const mapResult = await mappingsClient.send(
      new MapDocumentCommand({
        id: mappingId,
        content: event,
      })
    );
    console.log(`mapping result: ${JSON.stringify(mapResult)}`);

    // Translate the Guide schema-based JSON to X12 EDI
    const translation = await translateJsonToEdi(mapResult.content, guideId, envelope);

    // Save generated X12 EDI file to SFTP-accessible Bucket
    const destinationBucket = requiredEnvVar("SFTP_BUCKET_NAME");
    const destinationKey =
      `trading_partners/${ediMetadata.interchangeHeader.receiverId}/outbound/${isaControlNumber}-${ediMetadata.transactionSet}.edi`;
    const putCommandArgs: PutObjectCommandInput = {
      bucketName: destinationBucket,
      key: destinationKey,
      body: translation,
    };
    await bucketsClient.send(new PutObjectCommand(putCommandArgs));

    if (event.as2ConnectorId) {
      await as2Client.send(
        new StartFileTransferCommand({
          connectorId: event.as2ConnectorId,
          sendFilePaths: [`/${destinationBucket}/${destinationKey}`],
        }),
      );
    }

    await markExecutionAsSuccessful(executionId);

    return {
      statusCode: 200,
      ...putCommandArgs
    };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(`unknown error: ${serializeError(e)}`);
    return failedExecution(executionId, error);
  }
};
