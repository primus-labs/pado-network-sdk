import type { Bytes, Bytes32, ChainName, Task, Uint32 } from '../../types/index';
import BaseEvm from './base-evm';
import abiJson from './abi/taskMgt.json';

export default class TaskC extends BaseEvm {
  constructor(chainName: ChainName, wallet: any, address: string) {
    super(chainName, wallet, address);
    this._initContractInstance(abiJson);
  }

  /**
   * @notice Network Consumer submit confidential computing task to PADO Network.
   * @param taskType The type of the task.
   * @param consumerPk The Public Key of the Network Consumer.
   * @param dataId The id of the data. If provided, dataInfoRequest is ignored.
   * @param value fee
   * @return The UID of the new task
   */
  async submitTask(taskType: Uint32, consumerPk: Bytes, dataId: Bytes32, value: bigint): Promise<Bytes32> {
    console.log(`taskType :${taskType}`);
    console.log(`consumerPk :${consumerPk}`);
    console.log(`dataId :${dataId}`);
    console.log(`value :${value}`);
    const taskId = await this.contractInstance.submitTask(taskType, consumerPk, dataId, { value: value });
    return taskId;
  }

  /**
   * Asynchronously retrieves completed tasks by the specified task ID.
   * @param taskId The unique identifier of the task to retrieve.
   * @param timeout The maximum time to wait for the task to complete, in milliseconds.
   * @returns A string representation of the task data, or an empty string if no data is found.
   */
  async _getCompletedTaskByIdPromise(taskId: Bytes32, timeout: number): Promise<Task> {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      const tick = async () => {
        const timeGap = performance.now() - start;
        let task;
        try {
          task = await this.contractInstance.getCompletedTaskById(taskId);
        } catch (err) {
          // console.log(err);
        }
        if (task) {
          resolve(task);
        } else if (timeGap > timeout) {
          reject('timeout');
        } else {
          setTimeout(tick, 500);
        }
      };
      tick();
    });
  }
}