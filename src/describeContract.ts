/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/naming-convention */
import {
  isReady,
  Mina,
  PrivateKey,
  type PublicKey,
  fetchAccount,
} from 'snarkyjs';
import { ContractApi, type OffchainStateContract } from '@zkfs/contract-api';
import * as dotenv from 'dotenv';
dotenv.config();

import config from '../config.json';
import berkeleyAccount from '../keys/berkeley.json';
import { waitUntilNextBlock } from './network';
import { type Program } from './zkProgram';

interface ContractTestContext<ZkApp extends OffchainStateContract> {
  deployerAccount: PublicKey;
  deployerKey: PrivateKey;
  senderAccount: PublicKey;
  senderKey: PrivateKey;
  zkAppAddress: PublicKey;
  zkAppPrivateKey: PrivateKey;
  zkApp: ZkApp;
  contractApi: ContractApi;
  waitForNextBlock: () => Promise<void>;
  fetchAccounts: (publicKey: PublicKey[]) => Promise<void>;
  fetchEventsZkApp: () => Promise<any>;
  zkProgram: typeof Program;
}

let hasProofsEnabled = false;
const deployToBerkeley = Boolean(process.env.TEST_ON_BERKELEY?.toLowerCase());

if (deployToBerkeley) {
  hasProofsEnabled = true;
}

async function withTimer<Result>(
  name: string,
  callback: () => Promise<Result>
): Promise<Result> {
  console.log(`Starting ${name}`);
  console.time(name);
  const result = await callback();
  console.timeEnd(name);
  return result;
}

function describeContract<ZkApp extends OffchainStateContract>(
  name: string,
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
  Contract: typeof OffchainStateContract,
  zkProgram: typeof Program,
  testCallback: (context: () => ContractTestContext<ZkApp>) => void
) {
  describe(name, () => {
    beforeAll(async () => {
      await isReady;

      console.time(name);
      // eslint-disable-next-line max-len
      if (hasProofsEnabled) {
        // eslint-disable-next-line @typescript-eslint/require-await
        const analyzedMethods = await withTimer('analyzeMethods', async () =>
          Contract.analyzeMethods()
        );

        console.log('analyzed methods', analyzedMethods);

        await withTimer('compile', async () => {
          await zkProgram.compile();
          await Contract.compile();
        });
      }
    });

    afterAll(() => {
      console.timeEnd(name);
    });

    // eslint-disable-next-line @typescript-eslint/init-declarations
    let context: ContractTestContext<ZkApp>;

    beforeEach(() => {
      let localBlockchain = Mina.LocalBlockchain({
        proofsEnabled: hasProofsEnabled,
        enforceTransactionLimits: true,
      });

      if (deployToBerkeley) {
        const berkeley = Mina.Network({
          mina: config.networks.berkeley.mina,
          archive: config.networks.berkeley.archive,
        });
        Mina.setActiveInstance(berkeley);
      } else {
        Mina.setActiveInstance(localBlockchain);
      }

      let deployerKey: PrivateKey;
      let deployerAccount: PublicKey;
      if (deployToBerkeley) {
        deployerKey = PrivateKey.fromBase58(berkeleyAccount.privateKey);
      } else {
        // First test account is the deployer
        const { privateKey } = localBlockchain.testAccounts[0];
        deployerKey = privateKey;
      }
      deployerAccount = deployerKey.toPublicKey();

      let senderKey: PrivateKey;
      let senderAccount: PublicKey;
      if (deployToBerkeley) {
        // todo: use a different account for the sender
        senderKey = PrivateKey.fromBase58(berkeleyAccount.privateKey);
      } else {
        // Second test account is the deployer
        const { privateKey } = localBlockchain.testAccounts[1];
        senderKey = privateKey;
      }
      senderAccount = senderKey.toPublicKey();

      async function waitForNextBlock() {
        if (deployToBerkeley) {
          // provide parameters to overwrite defaults for number of retries and polling interval
          await waitUntilNextBlock();
        } else {
          localBlockchain.setBlockchainLength(
            localBlockchain.getNetworkState().blockchainLength.add(1)
          );
        }
      }

      async function fetchAccounts(publicKeys: PublicKey[]) {
        if (deployToBerkeley) {
          await Promise.all(
            publicKeys.map((publicKey) => fetchAccount({ publicKey }))
          );
        }
      }

      const zkAppPrivateKey = PrivateKey.random();
      const zkAppAddress = zkAppPrivateKey.toPublicKey();
      console.log('zkAppAddress', zkAppAddress.toBase58());

      const zkApp = new Contract(zkAppAddress) as ZkApp;
      const contractApi = new ContractApi();

      async function fetchEventsZkApp(): Promise<any> {
        if (deployToBerkeley) {
          return await zkApp.fetchEvents();
        } else {
          return localBlockchain.fetchEvents(zkAppAddress);
        }
      }

      context = {
        deployerAccount,
        deployerKey,
        senderAccount,
        senderKey,
        zkApp,
        zkAppAddress,
        zkAppPrivateKey,
        contractApi,
        waitForNextBlock,
        fetchAccounts,
        fetchEventsZkApp,
        zkProgram,
      };
    });

    testCallback(() => context);
  });
}

export default describeContract;
export { withTimer };
