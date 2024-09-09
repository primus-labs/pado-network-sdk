// import { ethers } from 'ethers';
import { arseedingBase64ToHexStr, arseedingHexStrToBase64 } from '../common/str-util';
import { DEFAULT_ENCRYPTION_SCHEMA, PADO_NETWORK_CONTRACT_ADDRESS } from '../config';
import Data from '../contracts/evm/data';
import Fee from '../contracts/evm/fee';
import Helper from '../contracts/evm/helper';
import Task from '../contracts/evm/task';
import Worker from '../contracts/evm/worker';
import {
  ChainName,
  StorageType,
  TaskType,
  Uint256,
  Wallets,
  type Address,
  type CommonObject,
  type EncryptionSchema,
  type FeeTokenInfo,
  type PriceInfo
} from '../types/index';
import BaseContract from './base-contract';

// import { THRESHOLD_2_3 } from '../common/utils';

const TASK_MAPPING: { [key in TaskType]: number } = {
  [TaskType.DATA_SHARING]: 0
};

export default class EthereumContract extends BaseContract {
  worker: any;
  data: any;
  task: any;
  fee: any;
  helper: any;

  constructor(chainName: ChainName, storageType: StorageType, wallets: Wallets) {
    super(chainName, storageType, wallets);
    const addresses = PADO_NETWORK_CONTRACT_ADDRESS[chainName];
    this.worker = new Worker(chainName, wallets.wallet.wallet, (addresses as any).workerMgt);
    this.data = new Data(chainName, wallets.wallet.wallet, (addresses as any).dataMgt);
    this.task = new Task(chainName, wallets.wallet.wallet, (addresses as any).taskMgt);
    this.fee = new Fee(chainName, wallets.wallet.wallet, (addresses as any).feeMgt);
    this.helper = new Helper(wallets.wallet.wallet);
  }

  /**
   * Encrypt data and upload encrypted data to decentralized storage blockchains such as Arweave and Filecoin.
   *
   * @param data - plain data need to encrypt and upload
   * @param dataTag - the data meta info object
   * @param priceInfo - The data price symbol(symbol is optional, default is wAR) and price. Currently only wAR(the Wrapped AR in ao) is supported, with a minimum price unit of 1 (1 means 0.000000000001 wAR).
   * @param permissionCheckers - The addresses of the permission checkers.
   * @param encryptionSchema EncryptionSchema
   *                    - uploadParam : The uploadParam object, which can be used to pass additional parameters to the upload process
   *                        - storageType : The storage type, default is ARWEAVE
   *                        - symbolTag :  The tag corresponding to the token used for payment. ref: https://web3infra.dev/docs/arseeding/sdk/arseeding-js/getTokenTag
   * @returns The uploaded encrypted data id
   */
  async uploadData(
    data: Uint8Array,
    dataTag: CommonObject,
    priceInfo: PriceInfo,
    permissionCheckers: Address[],
    encryptionSchema: EncryptionSchema = DEFAULT_ENCRYPTION_SCHEMA
  ) {
    const tx = await this.data.prepareRegistry(encryptionSchema);
    const receipt = await tx.wait();
    // console.log(receipt);
    const event = receipt.events.find((event: { event: any }) => event.event === 'DataPrepareRegistry');
    if (!event) {
      throw new Error('prepareRegistry failed');
    }
    const dataId = event.args.dataId;
    const publicKeys = event.args.publicKeys;
    const indices = [];
    const names = new Array(Number(encryptionSchema.n)).fill('');

    //get publickeys
    const rawPublickeys = [];
    for (let i = 0; i < publicKeys.length; i++) {
      const publicKeyHashInStorageHexStr = publicKeys[i];
      const rawPk = await this.storage.getData(arseedingHexStrToBase64(publicKeyHashInStorageHexStr));
      rawPublickeys.push(Buffer.from(rawPk).toString('hex'));
      indices.push(i + 1);
    }
    const policy = {
      t: Number(encryptionSchema.t),
      n: Number(encryptionSchema.n),
      indices,
      names
    };
    // console.log('rawPublickeys', rawPublickeys);
    // console.log('policy', policy);
    const encryptData = this.encrypt_v2(rawPublickeys, data, policy);
    const transactionIdMsg = await this.storage.submitData(encryptData.enc_msg);
    const transactionIdSks = await this.storage.submitData(encryptData.enc_sks);

    const transactionId = `enc_msg:${transactionIdMsg};enc_sks:${transactionIdSks}`;
    const transactionIdHexStr = arseedingHexStrToBase64(transactionId);
    dataTag['storageType'] = this.storageType;
    const dataTagStr = JSON.stringify(dataTag);
    const priceInfoStr = {
      tokenSymbol: 'ETH',
      price: priceInfo.price // TODO-ysm bigint
    };
    // console.log(`dataId:${dataId}`);
    // console.log(`dataTagStr :${dataTagStr}`);
    // console.log(`priceInfoStr:${priceInfoStr}`);
    // console.log(`transactionIdHexStr:${transactionIdHexStr}`);
    const registryTx = await this.data.register(dataId, dataTag, priceInfoStr, transactionIdHexStr, permissionCheckers);
    const registryReceipt = await registryTx.wait();
    const registryEvent = registryReceipt.events.find((event: { event: any }) => event.event === 'DataRegistered');
    if (!registryEvent) {
      throw new Error('data register failed');
    }
    return registryEvent.args.dataId;
  }

  /**
   * Asynchronously retrieves a list of data based on the specified status.
   * @param dataStatus - The status of the data to retrieve, defaults to 'Valid'.
   * @returns A promise that resolves to the retrieved data list.
   */
  async getDataList(dataStatus: string = 'Valid') {
    // console.log(`dataStatus is${dataStatus}`);
    const res = await this.data.getAllData();
    // TODO Filter data from various states
    return res;
  }

  /**
   * Asynchronously retrieves data by the specified ID.
   * @param dataId The unique identifier of the data to retrieve.
   * @returns A promise that resolves to the retrieved data.
   */
  async getDataById(dataId: string) {
    const res = await this.data.getDataById(dataId);
    return res;
  }

  /**
   * Submits a task for processing with the specified parameters.
   *
   * @param taskType - The type of task to be submitted.
   * @param dataId - The identifier of the data to be used in the task.
   * @param dataUserPk - The user's public key generated by generateKey of Utils.
   * @returns {Promise<string>} - The ID of the submitted task.
   */
  async submitTask(taskType: TaskType, dataId: string, dataUserPk: string) {
    const realTaskType = TASK_MAPPING[taskType];
    if (realTaskType === undefined) {
      throw new Error(`taskType ${taskType} is not supported`);
    }
    let encData = await this.data.getDataById(dataId);
    const { priceInfo: priceObj, workerIds } = encData;
    const { tokenSymbol: symbol, price: dataPrice } = priceObj;
    const isSupported = await this.fee.isSupportToken(symbol);
    if (!isSupported) {
      const supportTokens = await this.fee.getFeeTokens();
      const supportSymbols = supportTokens.map((i: FeeTokenInfo) => i.symbol);
      throw new Error(`Only support ${supportSymbols.join('/')} now!`);
    }
    //get node price

    const { computingPrice: nodePrice } = await this.fee.getFeeTokenBySymbol(symbol);
    const totalPrice = Number(dataPrice) + Number(nodePrice) * workerIds.length;

    // console.log(`Buffer.from(this.userKey.pk,'hex'):${Buffer.from(publicKey,'hex')}`);
    const pkTransactionHash = await this.storage.submitData(
      new Uint8Array(Buffer.from(dataUserPk, 'hex')),
      this.storageWallet
    );
    const pkTransactionHashHexStr = arseedingBase64ToHexStr(pkTransactionHash);
    const tx = await this.task.submitTask(realTaskType, pkTransactionHashHexStr, dataId, totalPrice);
    const receipt = await tx.wait();
    // console.log(receipt)
    const event = receipt.events.find((event: { event: any }) => event.event === 'TaskDispatched');
    if (!event) {
      throw new Error('submitTask failed');
    }
    return event.args.taskId;
  }

  /**
   * @param taskId - The ID of the task to retrieve the result for.
   * @param dataUserSk - The user's secret key generated by generateKey of Utils
   * @param timeout - The maximum timeout, in milliseconds, defaults to 60000.
   */
  async getTaskResult(taskId: string, dataUserSk: string, timeout: number = 60000): Promise<Uint8Array> {
    const task = await this.task._getCompletedTaskByIdPromise(taskId, timeout);

    const dataFromContract = await this.data.getDataById(task.dataId);
    const content = arseedingHexStrToBase64(dataFromContract.dataContent);
    // console.log(`itemIdForArSeeding:${itemIdForArSeeding}`);
    //get enc_msg
    // split by ';'
    const parts = content.split(';');

    // find enc_msg
    const encMsgPart = parts.find((part) => part.startsWith('enc_msg'));
    const encMsg = encMsgPart ? encMsgPart.split(':')[1] : null;

    const encData = await this.storage.getData(encMsg);
    const chosenIndices = [];
    const reencChosenSks = [];
    for (let i = 0; i < task.computingInfo.results.length; i++) {
      if (task.computingInfo.results[i].length === 0) {
        continue;
      }
      const dataItemId = arseedingHexStrToBase64(task.computingInfo.results[i]);
      reencChosenSks.push(Buffer.from(await this.storage.getData(dataItemId)).toString('hex'));
      chosenIndices.push(i + 1);
    }
    // console.log(`reencChosenSks:${reencChosenSks}`);
    // console.log(`encData:${encData}`);
    // console.log(`chosenIndices:${chosenIndices}`);
    const result = this.decrypt_v2(reencChosenSks, dataUserSk, encData, chosenIndices);
    return result.msg;
  }

  /**
   * @notice Get balance of token which can withdraw.
   * @param userAddress user wallet address
   * @param tokenSymbol token symbol
   */
  async getBalance(userAddress: Address, tokenSymbol: string) {
    return await this.fee.getBalance(userAddress, tokenSymbol);
  }

  /**
   * withdraw token
   * @param toAddress
   * @param tokenSymbol
   * @param amount
   */
  async withdrawToken(toAddress: Address, tokenSymbol: string, amount: Uint256) {
    return await this.fee.withdrawToken(toAddress, tokenSymbol, amount);
  }
}
