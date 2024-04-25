import {
    result,
    message,
    dryrun,
  } from "@permaweb/aoconnect";
import { NODEREGISTRY_PROCESS_ID } from "../config";

export const register = async (name: string, 
    pk: string, desc: string, signer: any) => {
    const msgId = await message({
        process: NODEREGISTRY_PROCESS_ID,
        // Tags that the process will use as input.
        tags: [
          { name: "Action", value: "Register" },
          { name: "Name", value: name},
          { name: "Desc", value: desc},
        ],
        // A signer function used to build the message "signature"
        signer: signer,
        data: pk,
      });
    let { Messages } = await result({
        // the arweave TXID of the message
        message: msgId,
        // the arweave TXID of the process
        process: NODEREGISTRY_PROCESS_ID,
      });
    const res = Messages[0].Data;
    return res;
}

export const update = async (name: string, 
  pk: string, desc: string, signer: any) => {
  const msgId = await message({
      process: NODEREGISTRY_PROCESS_ID,
      // Tags that the process will use as input.
      tags: [
        { name: "Action", value: "Update" },
        { name: "Name", value: name},
        { name: "Desc", value: desc},
      ],
      // A signer function used to build the message "signature"
      signer: signer,
      data: pk,
    });
  let { Messages } = await result({
      // the arweave TXID of the message
      message: msgId,
      // the arweave TXID of the process
      process: NODEREGISTRY_PROCESS_ID,
    });
  const res = Messages[0].Data;
  return res;
}

export const nodes = async () => {
    let { Messages } = await dryrun({
        process: NODEREGISTRY_PROCESS_ID,
        tags: [
          { name: "Action", value: "Nodes" },
        ],
      });
    const nodes = Messages[0].Data;
    return nodes;
}
