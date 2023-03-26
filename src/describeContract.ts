/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/naming-convention */
import { isReady, Mina, PrivateKey, type PublicKey } from 'snarkyjs';
import { ContractApi, type OffchainStateContract } from '@zkfs/contract-api';

import config from '../config.json';
import { waitUntilNextBlock } from './network';

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
}

const hasProofsEnabled = false;
const deployToBerkeley = false;

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
        enforceTransactionLimits: false,
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
        deployerKey = PrivateKey.fromBase58(
          'EKEMLj1pbDV4MGoZXChSp2z1AJuiW5p9YdUY93VYENpMkD8zcrmh'
        );
      } else {
        // First test account is the deployer
        const { privateKey } = localBlockchain.testAccounts[0];
        deployerKey = privateKey;
      }
      deployerAccount = deployerKey.toPublicKey();

      let senderKey: PrivateKey;
      let senderAccount: PublicKey;
      if (deployToBerkeley) {
        senderKey = PrivateKey.fromBase58(
          'EKEao8v85te67ezsZbdQQq8hsf8B7NTt55kkbFYFDMKdqasYavPQ'
        );
      } else {
        // Second test account is the deployer
        const { privateKey } = localBlockchain.testAccounts[1];
        senderKey = privateKey;
      }
      senderAccount = senderKey.toPublicKey();

      async function waitForNextBlock() {
        if (deployToBerkeley) {
          await waitUntilNextBlock();
        } else {
          localBlockchain.setBlockchainLength(
            localBlockchain.getNetworkState().blockchainLength.add(1)
          );
        }
      }

      const zkAppPrivateKey = PrivateKey.random();
      const zkAppAddress = zkAppPrivateKey.toPublicKey();
      console.log('zkAppAddress', zkAppAddress.toBase58());

      const zkApp = new Contract(zkAppAddress) as ZkApp;
      const contractApi = new ContractApi();

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
      };
    });

    testCallback(() => context);
  });
}

export default describeContract;
export { withTimer };
