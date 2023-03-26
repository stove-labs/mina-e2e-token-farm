import { AccountUpdate, fetchAccount, UInt64 } from 'snarkyjs';

import { Farm } from './Farm.js';
import describeContract from './describeContract.js';
import { Key } from '@zkfs/contract-api';
import OffchainStateBackup from '@zkfs/contract-api/dist/offchainStateBackup.js';

describeContract<Farm>('farm', Farm, (context) => {
  async function localDeploy() {
    const {
      deployerAccount,
      deployerKey,
      zkAppPrivateKey,
      zkApp,
      contractApi,
    } = context();

    const tx = await contractApi.transaction(
      zkApp,
      { sender: deployerAccount, fee: 1e9 },
      () => {
        AccountUpdate.fundNewAccount(deployerAccount);
        zkApp.deploy();
      }
    );
    await tx.prove();

    // this tx needs .sign(), because `deploy()` adds an account update
    // that requires signature authorization
    await tx.sign([deployerKey, zkAppPrivateKey]).send();
    return tx;
  }

  it('dispatches 1 action and calls rollup on `Farm` smart contract', async () => {
    expect.assertions(2);

    const { senderAccount, senderKey, zkApp, contractApi, waitForNextBlock } =
      context();

    const tx0 = await localDeploy();
    await waitForNextBlock();

    OffchainStateBackup.restoreLatest(zkApp);

    // Local.setBlockchainLength(Local.getNetworkState().blockchainLength.add(1))
    // Local.setBlockchainLength(Local.getNetworkState().blockchainLength.add(1))
    // await fetchAccount({ publicKey: senderAccount })
    // await fetchAccount({ publicKey: zkApp.address })
    console.log('Farm.deploy() successful, initial offchain state:', {
      offchainStateRootHash: zkApp.offchainStateRootHash.get().toString(),
      data: zkApp.virtualStorage?.data[zkApp.address.toBase58()],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      tx: tx0.toPretty(),
    });

    console.log('Farm.deposit(), dispatching an action...');

    const tx1 = await contractApi.transaction(
      zkApp,
      { sender: senderAccount, fee: 1e9 },
      () => {
        zkApp.deposit(senderAccount, UInt64.from(30));
      }
    );

    await tx1.prove();
    await tx1.sign([senderKey]).send();

    OffchainStateBackup.restoreLatest(zkApp);

    await waitForNextBlock();
    // await fetchAccount({ publicKey: senderAccount })
    // await fetchAccount({ publicKey: zkApp.address })
    console.log('Farm.rollup(), rolling up actions...', {
      delegators:
        zkApp.delegators.contract?.virtualStorage?.data[
          zkApp.address.toBase58()
        ],
    });

    //Local.setBlockchainLength(Local.getNetworkState().blockchainLength.add(1))

    const tx2 = await contractApi.transaction(
      zkApp,
      { sender: senderAccount, fee: 1e9 },
      () => {
        zkApp.rollup();
      }
    );

    await tx2.prove();
    await tx2.sign([senderKey]).send();

    OffchainStateBackup.restoreLatest(zkApp);
    await waitForNextBlock();
    // await fetchAccount({ publicKey: senderAccount })
    // await fetchAccount({ publicKey: zkApp.address })
    console.log('Farm.rollup() successful, new offchain state:', {
      offchainStateRootHash: zkApp.offchainStateRootHash.get().toString(),
      data: zkApp.virtualStorage?.data[zkApp.address.toBase58()],
      deposit: zkApp.virtualStorage?.getSerializedValue(
        zkApp.address.toBase58(),
        Key.fromString('delegators').toString(),
        Farm.addressToKey(senderAccount).toString()
      ),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      tx: tx2.toPretty(),
    });

    const farmData = zkApp.farmData.get();
    expect(farmData.accumulatedRewardsPerShare.toString()).toEqual('503');
    expect(farmData.totalStakedBalance.toString()).toEqual('32');
    console.log('events', await zkApp.fetchEvents());
    // const finalHeight = Local.getNetworkState().blockchainLength.toString();
    // console.log('height from local',)
    //expect(zkApp.lastUpdate.get().toString()).toEqual(finalHeight)
  }, 60_000_000);
});
