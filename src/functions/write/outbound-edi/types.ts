import { z } from "zod";

export const InterchangeHeader = z.strictObject({
  senderQualifier: z.string().default("ZZ"),
  senderId: z.string(),
  receiverQualifier: z.string().default("02"),
  receiverId: z.string(),
  usageIndicatorCode: z.union([
    z.literal("T"),
    z.literal("P"),
    z.literal("I")
  ]).default("T"),
});

export const GroupHeader = z.strictObject({
  applicationSenderCode: z.string().optional(),
  applicationReceiverCode: z.string().optional(),
});

export const EdiMetadata = z.strictObject({
  release: z.string(),
  transactionSet: z.string(),
  interchangeHeader: InterchangeHeader,
  groupHeader: GroupHeader.optional(),
});
