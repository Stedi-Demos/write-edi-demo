import { invokeFunction } from "../support/functions.js";
import fs from "fs";

const DEFAULT_LOOP_COUNT = 5;

const DEFAULT_850_PAYLOAD = JSON.parse(fs.readFileSync("./src/resources/X12/5010/850/input.json", "utf-8"));
const DEFAULT_855_PAYLOAD = JSON.parse(fs.readFileSync("./src/resources/X12/5010/855/input.json", "utf-8"));
const DEFAULT_INVOCATION_PAYLOADS = [DEFAULT_850_PAYLOAD, DEFAULT_855_PAYLOAD];

(async () => {
  const functionName = "write-outbound-edi";
  const loopCount: number = parseInt(process.argv[2]) || DEFAULT_LOOP_COUNT;
  console.log(`Invoking ${functionName} function with loop count: ${loopCount}\n`);

  const iterations = Array.from(Array(loopCount).keys());
  const promises = iterations.map(async (iteration) => {
    return await Promise.all(DEFAULT_INVOCATION_PAYLOADS.map(async (payload) => {
      const invocationResult = await invokeFunction(functionName, payload);

      const result = {
        iteration,
        transaction: payload.ediMetadata.code,
        invocationResult
      };

      console.log(JSON.stringify(result));
      return result;
    }));
  });

  const results = await Promise.all(promises);

  console.log(`\nDone. Batch invocation count: ${loopCount * DEFAULT_INVOCATION_PAYLOADS.length}`);

  // exit with non-successful response if any failures were encountered
  if (results.flat().some((result) => result.hasOwnProperty("failureRecord"))) {
    console.log(`errors encountered during processing`);
    process.exit(-1);
  }
})();
