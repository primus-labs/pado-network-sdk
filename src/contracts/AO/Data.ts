import { createDataItemSigner, dryrun, message, result } from '@permaweb/aoconnect';
import Arweave from 'arweave';
import { DATAREGISTRY_PROCESS_ID } from '../../config';
import { encrypt } from '../../core/utils';
import { StorageType, type CommonObject, type EncryptionSchema, type nodeInfo, type PolicyInfo } from '../../index.d';
import { submitDataToArseeding } from '../../padoarseeding';
import { ARConfig, submitDataToAR } from '../../padoarweave';
import { getMessageResultData } from '../../processes/utils';
import BaseData from '../BaseData';
import Worker from './Worker';


export default class AOData extends BaseData {
  /**
   * @notice Data Provider prepare to register confidential data to PADO Network.
   * @param encryptionSchema EncryptionSchema
   * @return policy and public keys
   */
  async prepareRegistry(encryptionSchema: EncryptionSchema): Promise<any> {
    let nodeInfos = await new Worker().getNodeInfos(Number(encryptionSchema.n), true);
    const [policy, publicKeys] = await this._formatPolicy(encryptionSchema, nodeInfos);
    return [policy, publicKeys];
  }
  /**
   * Asynchronously registers data.
   *
   * This method is used to register data within the data registry process. It accomplishes this by sending a message containing registration details and waiting for the processing result of that message to complete the registration process.
   *
   * @param dataTag The data tag, used to identify the data being registered.
   * @param price The price of the data, specifying the selling price of this data.
   * @param exData Extra data, which can be any supplementary information related to the registered data.
   * @param computeNodes An array of compute nodes, indicating the compute nodes associated with this data.
   * @param signer The signing entity, responsible for signing the message.
   * @returns The result data obtained from the message processing result.
   */
  async register(dataTag: string, price: string, exData: string, computeNodes: string[], signer: any) {
    const msgId = await message({
      process: DATAREGISTRY_PROCESS_ID,
      tags: [
        { name: 'Action', value: 'Register' },
        { name: 'DataTag', value: dataTag },
        { name: 'Price', value: price },
        { name: 'ComputeNodes', value: JSON.stringify(computeNodes) }
      ],
      signer: signer,
      data: exData
    });

    let Result = await result({
      message: msgId,
      process: DATAREGISTRY_PROCESS_ID
    });

    const res = getMessageResultData(Result);
    return res;
  }

  /**
   * Asynchronous function: encrypts data.
   *
   * This function is used to encrypt a given piece of data using a specified encryption policy and public keys. It first checks if the data to be encrypted is empty, then performs the encryption operation, and finally returns the encrypted data along with the encryption policy.
   *
   * @param data A Uint8Array type data to be encrypted.
   * @param policy An encryption policy that specifies how the data is encrypted.
   * @param publicKeys An array of strings containing the public keys used for encryption.
   * @returns Returns a Promise, which resolves to an object containing the encrypted data and encryption policy.
   * @throws If the data to be encrypted is empty, an error is thrown.
   */
  encryptData(data: Uint8Array, policy: PolicyInfo, publicKeys: string[]): CommonObject {
    if (data.length === 0) {
      throw new Error('The Data to be encrypted can not be empty');
    }
    const res = encrypt(publicKeys, data, policy);
    return Object.assign(res, { policy });
  }

  /**
   * Asynchronously retrieves all data based on the specified data status.
   *
   * @param dataStatus - The status of the data to retrieve, defaults to 'Valid'.
   * @returns A promise that resolves to the retrieved data.
   */
  async allData(dataStatus: string = 'Valid') {
    let { Messages } = await dryrun({
      process: DATAREGISTRY_PROCESS_ID,
      tags: [
        { name: 'Action', value: 'AllData' },
        { name: 'DataStatus', value: dataStatus }
      ]
    });
    const res = Messages[0].Data;
    return res;
  }

  /**
   * Asynchronously retrieves data by its ID.
   *
   * This function calls the dryrun interface, passing a specific process ID and tags to request information for a particular data ID.
   * It is primarily applicable in scenarios where data needs to be fetched from the data registry center based on the data ID.
   *
   * @param dataId The unique identifier ID of the data.
   * @returns The specific data extracted from the interface response.
   */
  async getDataById(dataId: string) {
    let { Messages } = await dryrun({
      process: DATAREGISTRY_PROCESS_ID,
      tags: [
        { name: 'Action', value: 'GetDataById' },
        { name: 'DataId', value: dataId }
      ]
    });
    const res = Messages[0].Data;
    return res;
  }

  /**
   * Asynchronously submits data.
   *
   * This function is used to submit encrypted data, data tags, price information, and policies to the system,
   * sign it with a wallet, and register it with the compute nodes.
   *
   * @param encryptData The encrypted data object to be submitted.
   * @param dataTag The data tag object associated with the data being submitted.
   * @param priceInfo The price information object related to the data submission.
   * @param policy The policy object that defines how the data should be handled.
   * @param wallet The wallet object used for signing the transaction.
   * @param extParam An optional extra parameter object that can be passed.
   * @returns A promise that resolves to a common object representing the data ID.
   */
  async submitData(
    encryptData: CommonObject,
    dataTag: CommonObject,
    priceInfo: CommonObject,
    policy: PolicyInfo,
    wallet: any,
    extParam?: CommonObject
  ): Promise<CommonObject> {
    const txData = await this._formatTxData(encryptData, dataTag, wallet, extParam);
    const dataTagStr = JSON.stringify(dataTag);
    const priceInfoStr = JSON.stringify(priceInfo);
    const txDataStr = JSON.stringify(txData);
    const computeNodes = policy.names;
    const signer = this._formatSigner(wallet);
    const dataId = this.register(dataTagStr, priceInfoStr, txDataStr, computeNodes, signer);
    return dataId;
  }

  /**
   * Formats the encryption policy and collects public keys of nodes.
   *
   * This method takes an encryption schema and an array of node information,
   * then formats the policy by incorporating indices and names from node information,
   * and also compiles an array of public keys from these nodes.
   * It is primarily used to prepare the configuration required for encrypting data.
   *
   * @param encryptionSchema - The encryption schema object containing parameters of the encryption policy.
   * @param nodeInfos - An array of nodeInfo objects, each containing details about a node including its index, name, and public key.
   * @returns A tuple where the first element is the formatted policyInfo object with updated indices and names, and the second element is an array of public keys corresponding to the nodes.
   */
  private _formatPolicy(encryptionSchema: EncryptionSchema, nodeInfos: Array<nodeInfo>): [PolicyInfo, string[]] {
    let policy = Object.assign(
      {
        indices: [] as number[],
        names: [] as string[]
      },
      encryptionSchema
    );

    let nodesPublicKey = [] as string[];
    for (let i = 0; i < nodeInfos.length; i++) {
      policy.indices.push(nodeInfos[i].index);
      policy.names.push(nodeInfos[i].name);
      nodesPublicKey.push(nodeInfos[i].pk);
    }
    const formatPolicy = { ...policy, t: Number(policy.t), n: Number(policy.n) };

    return [formatPolicy, nodesPublicKey];
  }

  private async _formatTxData(
    encryptedData: CommonObject,
    dataTag: CommonObject,
    wallet: any,
    extParam?: CommonObject
  ): Promise<CommonObject> {
    if (!encryptedData) {
      throw new Error('The encrypted Data to be uploaded can not be empty');
    }
    let transactionId;
    const arweave: Arweave = Arweave.init(ARConfig);
    if (StorageType.ARSEEDING === extParam?.uploadParam?.storageType) {
      dataTag['storageType'] = StorageType.ARSEEDING;
      transactionId = await submitDataToArseeding(
        arweave,
        encryptedData.enc_msg,
        wallet,
        extParam.uploadParam.symbolTag
      );
    } else {
      dataTag['storageType'] = StorageType.ARWEAVE;
      transactionId = await submitDataToAR(arweave, encryptedData.enc_msg, wallet);
    }

    let exData = {
      policy: encryptedData.policy,
      nonce: encryptedData.nonce,
      transactionId: transactionId,
      encSks: encryptedData.enc_sks
    };
    return exData;
  }
  /**
   * Formats the signer object.
   *
   * This method creates and returns a formatted signer object, which can be used for subsequent signing operations.
   * It accepts a wallet object as a parameter, which is used to generate the signer.
   *
   * @param wallet - The wallet object from which the signer will be created.
   * @returns The formatted signer object.
   */
  private _formatSigner(wallet: any): any {
    const signer = createDataItemSigner(wallet);
    return signer;
  }
}